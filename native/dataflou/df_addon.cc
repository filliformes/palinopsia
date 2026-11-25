// Palinopsia's dataflou node : a small N-API addon on dataflou's C interface
// (sdk/dataflou/capi/include/dataflou_c.h, API 0.6, core 9.3).
// third-party: The dataflou core
//
// A df_node belongs to ONE thread : created, called and polled there, its callbacks
// run inside df_node_poll(). So each node open()ed here has a thread of its own,
// polling every few ms whatever the main process is doing :
//   · what JavaScript asks is queued and run between two polls, in order; an answer
//     comes back as an event with the number the call was given;
//   · what the node says (values, triggers, destinations, the mesh's signals) is
//     queued, and JavaScript is woken once to drain() it all.
// Nothing of the core is ever touched from the JavaScript thread. Values waiting to be
// drained are bounded : past a point only the newest of each path is kept (a
// trigger's firings are counted, never dropped).
//
// Watching : the core looks at every watched param twice a poll (1.3 us each, so 500
// of them cost 16 % of a processor at 250 polls a second). Only what is, or was,
// connected is watched; what can only be set by a hand on the mesh (a visualizer, a
// script) is looked at 25 times a second, its value against the one we know.
//
// Triggers fed by something else than a trigger : in the core anything that arrives
// fires them (each change of a fader, each refresh, the value sent as a connection is
// made). Here such a source fires on its rising edge, half way up its range, as a
// wire into an action has always played Palinopsia (see TriggerGate).

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN  // or `interface` (df_config's) is a macro
#endif
#endif

#include <node_api.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "dataflou_c.h"

#include "cJSON.h"
#include "desktop/fine_timer.h"

namespace {

using Clock = std::chrono::steady_clock;

constexpr size_t kQueueSoft = 8192;     // past it, only the newest value of a path waits
constexpr size_t kMaxPath = 255;        // what the core takes
constexpr size_t kMaxText = 1 << 20;    // a text of ours, read whole

// ── what the node says, waiting for drain() ────────────────────────────────

struct Value {
  enum Kind { Null, Bool, Number, Text, List } kind = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<double> list;
};

struct Event {
  enum Kind { Val, Fire, Dest, Locate, Halt, Peer, Scene, Topology, Log, Reply, Started, Failed, Params } kind = Val;
  std::string path, text;
  Value value;
  double n[6] = { 0, 0, 0, 0, 0, 0 };
};

Value of_c(const df_value& v) {
  Value o;
  switch (v.type) {
    case DF_BOOL: o.kind = Value::Bool; o.b = v.b; break;
    case DF_NUMBER:
    case DF_TRIGGER: o.kind = Value::Number; o.n = v.n; break;
    case DF_V2: o.kind = Value::List; o.list = { v.v[0], v.v[1] }; break;
    case DF_V3: o.kind = Value::List; o.list = { v.v[0], v.v[1], v.v[2] }; break;
    case DF_V4: o.kind = Value::List; o.list = { v.v[0], v.v[1], v.v[2], v.v[3] }; break;
    case DF_COLOUR: o.kind = Value::List; o.list = { double(v.rgba[0]), double(v.rgba[1]), double(v.rgba[2]), double(v.rgba[3]) }; break;
    case DF_STRING:
    case DF_BLOB: o.kind = Value::Text; o.s = v.s; break;
    case DF_ARRAY: o.kind = Value::Number; o.n = v.n; break;  // how many : its elements come through on_array
    default: break;  // unknown, or a type from a later core : no value
  }
  return o;
}

// What a call carries : strings and numbers, checked on the way in
struct Args {
  std::vector<std::string> s;
  std::vector<double> n;
  Value value;
  std::vector<std::pair<std::string, Value>> sets;
  df_transform transform{};
};

struct Axes;

// ── one node, on its thread ────────────────────────────────────────────────

class Node {
 public:
  // what it is made with
  std::string name, sku, product, universe, dir, config;
  int poll_ms = 4;

  napi_threadsafe_function wake = nullptr;

  std::thread thread;
  std::mutex m;
  std::condition_variable cv;
  std::vector<std::function<void()>> commands;  // guarded by m
  bool quit = false, go = false;                // guarded by m

  std::mutex em;
  std::vector<Event> events;                            // guarded by em
  std::unordered_map<std::string, size_t> newest;       // guarded by em (past kQueueSoft)
  std::unordered_map<std::string, size_t> newest_fire;  // guarded by em (past kQueueSoft)
  std::atomic<bool> woken{ false };

  // the thread's own
  df_node* node = nullptr;
  bool polling = false;
  bool topology = false;
  std::set<std::string> declared_triggers;
  std::map<std::string, double> trigger_last;  // how many times it had fired here
  std::vector<std::pair<std::string, int>> fired;  // this poll
  // every param of ours the mesh may set, and what we know of the ones not watched
  struct Known {
    bool hot = false;
    df_type type = DF_UNKNOWN;
    double n = 0;
    float v[4] = { 0, 0, 0, 0 };
    std::string s;
  };
  std::map<std::string, Known> cold;
  std::set<std::string> watched;  // df_watch is for the node's life
  std::vector<std::string> warming;  // connected in this poll : watched after it
  Clock::time_point swept{};
  // what drives our triggers without being one (TriggerGate)
  struct Gate {
    std::string sku, path;
    bool invert = false;
    bool is_bool = false;
    bool unknown = false;  // its node has not declared it yet (just met)
    double lo = 0, hi = 1;
    int on = -1;  // -1 : not seen yet
  };
  std::map<std::string, std::vector<Gate>> gates;  // trigger path → its sources that are none
  std::set<std::string> gate_pure;                 // every source of it is in gates
  bool gates_stale = true;
  std::set<std::string> gate_invert;  // "path\nsku\nsource"
  // timing, read by "stats"
  uint64_t polls = 0;
  double poll_sum = 0, poll_max = 0, late_sum = 0, late_max = 0;
  uint64_t late_over_5 = 0, late_over_10 = 0;

  ~Node() { close(); }

  void post(std::function<void()> f) {
    {
      std::lock_guard<std::mutex> l(m);
      if (quit) return;
      commands.push_back(std::move(f));
    }
    cv.notify_one();
  }

  void say(Event e) {
    {
      std::lock_guard<std::mutex> l(em);
      if (events.size() >= kQueueSoft && (e.kind == Event::Val || e.kind == Event::Fire)) {
        auto& at = e.kind == Event::Val ? newest : newest_fire;
        auto it = at.find(e.path);
        if (it != at.end()) {
          if (e.kind == Event::Fire) events[it->second].n[0] += e.n[0];
          else events[it->second].value = std::move(e.value);
          return;
        }
        at[e.path] = events.size();
      }
      if (events.size() >= kQueueSoft * 4 && e.kind == Event::Log) return;
      events.push_back(std::move(e));
    }
    if (wake && !woken.exchange(true)) napi_call_threadsafe_function(wake, nullptr, napi_tsfn_nonblocking);
  }

  void start_thread() {
    thread = std::thread([this] { run(); });
  }

  void close() {
    {
      std::lock_guard<std::mutex> l(m);
      quit = true;
      commands.clear();
    }
    cv.notify_one();
    if (thread.joinable()) thread.join();
  }

  // ── callbacks (inside df_node_poll) ──
  static void on_change(const char* path, const df_value* v, void* x) {
    auto* self = static_cast<Node*>(x);
    if (self->declared_triggers.count(path)) {
      // Its count goes up by one a firing. One not higher than the last is not
      // news : the param was removed and declared again (its count starts over)
      double& last = self->trigger_last[path];
      if (!(v->n > last)) return;
      last = v->n;
      if (!self->fired.empty() && self->fired.back().first == path) self->fired.back().second++;
      else self->fired.emplace_back(path, 1);
      return;
    }
    if (v->type == DF_ARRAY) return;  // on_array
    Event e;
    e.kind = Event::Val;
    e.path = path;
    e.value = of_c(*v);
    if (e.value.kind == Value::Text) {
      // whole : df_value holds its first 128 bytes
      const long len = df_get_text(self->node, path, nullptr, 0);
      if (len > 128 && size_t(len) <= kMaxText) {
        std::string s(size_t(len) + 1, '\0');
        if (df_get_text(self->node, path, s.data(), s.size()) == len) {
          s.resize(size_t(len));
          e.value.s = std::move(s);
        }
      }
    }
    self->say(std::move(e));
  }
  static void on_array(const char* path, df_elem of, const void* values, size_t count, void* x) {
    Event e;
    e.kind = Event::Val;
    e.path = path;
    e.value.kind = Value::List;
    for (size_t i = 0; i < count; ++i) {
      switch (of) {
        case DF_ELEM_FLOAT: e.value.list.push_back(static_cast<const float*>(values)[i]); break;
        case DF_ELEM_INT: e.value.list.push_back(static_cast<const int32_t*>(values)[i]); break;
        case DF_ELEM_BOOL: e.value.list.push_back(static_cast<const bool*>(values)[i] ? 1 : 0); break;
        case DF_ELEM_BYTE: e.value.list.push_back(static_cast<const uint8_t*>(values)[i]); break;
        default: return;  // colours, or a later core's : none of ours
      }
    }
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_destination(const char* path, const df_destination* d, void* x) {
    if (d->connections > 0 && !static_cast<Node*>(x)->watched.count(path)) static_cast<Node*>(x)->warming.emplace_back(path);
    Event e;
    e.kind = Event::Dest;
    e.path = path;
    e.n[0] = d->state;
    e.n[1] = d->origin;
    e.n[2] = d->connections;
    e.n[3] = d->live;
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_locate(const char* path, bool on, void* x) {
    Event e;
    e.kind = Event::Locate;
    e.path = path;
    e.n[0] = on;
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_halt(bool on, void* x) {
    Event e;
    e.kind = Event::Halt;
    e.n[0] = on;
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_peer(bool joined, const char* sku, const char* label, void* x) {
    Event e;
    e.kind = Event::Peer;
    e.path = sku;
    e.text = label;
    e.n[0] = joined;
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_scene(df_scene_op op, int slot, const df_scene* s, void* x) {
    Event e;
    e.kind = Event::Scene;
    e.n[0] = op;
    e.n[1] = slot;
    e.n[2] = s->state;
    e.n[3] = s->skipped;
    e.n[4] = s->current;
    e.n[5] = s->slots;
    static_cast<Node*>(x)->say(std::move(e));
  }
  static void on_topology(void* x) { static_cast<Node*>(x)->topology = true; }
  static void on_log(const char* line, void* x) {
    Event e;
    e.kind = Event::Log;
    e.text = line;
    static_cast<Node*>(x)->say(std::move(e));
  }

  // ── the thread ──
  void fail(const std::string& why) {
    Event e;
    e.kind = Event::Failed;
    e.text = why;
    say(std::move(e));
  }

  void run() {
    dataflou::FineTimer fine;  // sleeps to the millisecond, while the node runs
    try {
      df_config c;
      std::memset(&c, 0, sizeof c);
      c.size = sizeof c;
      c.name = name.c_str();
      c.sku = sku.c_str();
      c.product = product.c_str();
      c.universe = universe.c_str();
      c.storage_dir = dir.c_str();
      node = df_node_create(&c);
      if (!node) {
        fail("the node could not be made");
        return;
      }
      df_node_on_log(node, on_log, this);
      df_node_on_change(node, on_change, this);
      df_node_on_array(node, on_array, this);
      df_node_on_destination(node, sizeof(df_destination), on_destination, this);
      df_node_on_locate(node, on_locate, this);
      df_node_on_halt(node, on_halt, this);
      df_node_on_peer(node, on_peer, this);
      df_node_on_scene(node, on_scene, this);
      df_node_on_topology(node, on_topology, this);
      if (!df_node_load_json(node, config.c_str())) {
        fail("its parameters were refused");
        df_node_destroy(node);
        node = nullptr;
        return;
      }
      if (!df_node_start(node)) {
        fail("no port to listen on");
        df_node_destroy(node);
        node = nullptr;
        return;
      }
      polling = true;
      {
        Event e;
        e.kind = Event::Started;
        e.n[0] = df_node_port(node);
        say(std::move(e));
      }
      loop();
    } catch (const std::exception& x) {
      fail(x.what());
    } catch (...) {
      fail("the node stopped on an error");
    }
    if (node) {
      try {
        df_node_stop(node);
        df_node_destroy(node);
      } catch (...) {
      }
      node = nullptr;
    }
  }

  void loop() {
    auto next = Clock::now();
    const auto step = std::chrono::milliseconds(poll_ms);
    for (;;) {
      std::vector<std::function<void()>> todo;
      bool started = false;
      {
        std::unique_lock<std::mutex> l(m);
        cv.wait_until(l, next, [this] { return quit || !commands.empty(); });
        if (quit) return;
        todo.swap(commands);
        started = go;
      }
      for (auto& f : todo) f();
      // nothing polled before JavaScript said so : what it changes as the node
      // starts (a session's wires) is in place before any value comes in
      if (!started) {
        next = Clock::now() + step;
        continue;
      }
      const auto t0 = Clock::now();
      if (t0 < next && !todo.empty() && t0 + std::chrono::milliseconds(1) < next) continue;  // the poll when it is due
      const double late = std::chrono::duration<double, std::milli>(t0 - next).count();
      df_node_poll(node);
      const auto t1 = Clock::now();
      const double took = std::chrono::duration<double, std::milli>(t1 - t0).count();
      ++polls;
      poll_sum += took;
      poll_max = std::max(poll_max, took);
      if (late > 0) {
        late_sum += late;
        late_max = std::max(late_max, late);
        if (late > 5) ++late_over_5;
        if (late > 10) ++late_over_10;
      }
      if (topology) gates_stale = true;
      for (const auto& p : warming) warm(p);
      warming.clear();
      if (t1 - swept >= std::chrono::milliseconds(40)) {
        swept = t1;
        for (auto& [p, k] : cold)
          if (!k.hot) look(p, k, true);
      }
      triggers();
      if (topology) {
        topology = false;
        Event e;
        e.kind = Event::Topology;
        say(std::move(e));
      }
      next += step;
      if (next < Clock::now()) next = Clock::now() + std::chrono::milliseconds(1);
    }
  }

  // A param of ours as it is now; `say_it` : a change of it is news (it came from the mesh)
  void look(const std::string& path, Known& k, bool say_it) {
    df_value v;
    if (!df_get(node, path.c_str(), &v)) return;
    bool same = v.type == k.type;
    double n = v.type == DF_BOOL ? (v.b ? 1 : 0) : v.n;
    if (same) {
      switch (v.type) {
        case DF_BOOL:
        case DF_NUMBER:
        case DF_TRIGGER: same = n == k.n; break;
        case DF_V2:
        case DF_V3:
        case DF_V4: same = !std::memcmp(v.v, k.v, sizeof k.v); break;
        case DF_COLOUR: same = !std::memcmp(v.rgba, k.v, sizeof v.rgba); break;
        case DF_STRING:
        case DF_BLOB: same = k.s == v.s; break;
        default: break;
      }
    }
    if (same) return;
    if (say_it) {
      if (v.type == DF_TRIGGER) {
        // each firing since we looked
        const double last = k.type == DF_TRIGGER ? k.n : 0;
        for (double c = last + 1; c <= n && c < last + 65; ++c) {
          v.n = c;
          on_change(path.c_str(), &v, this);
        }
      } else {
        on_change(path.c_str(), &v, this);
      }
    }
    k.type = v.type;
    k.n = n;
    if (v.type == DF_COLOUR) std::memcpy(k.v, v.rgba, sizeof v.rgba);
    else std::memcpy(k.v, v.v, sizeof k.v);
    if (v.type == DF_STRING || v.type == DF_BLOB) k.s = v.s;
  }
  // It is connected : watched from now on (what came in this very poll is looked at)
  void warm(const std::string& path) {
    auto it = cold.find(path);
    if (it == cold.end() || it->second.hot) return;
    look(path, it->second, true);
    it->second.hot = true;
    watched.insert(path);
    df_watch(node, path.c_str());
  }

  // ── TriggerGate ──
  // Our triggers that something else than a trigger feeds, from the world as it
  // is (read again when it changed).
  void read_gates() {
    gates_stale = false;
    auto had = std::move(gates);
    gates.clear();
    gate_pure.clear();
    char* json = df_world_json(node);
    if (!json) return;
    cJSON* root = cJSON_Parse(json);
    df_free(json);
    const char* me = df_node_sku(node);
    struct P {
      std::string type;
      double lo = 0, hi = 1;
    };
    std::map<std::string, std::map<std::string, P>> world;
    const cJSON* n = nullptr;
    const cJSON* mine = nullptr;
    cJSON_ArrayForEach(n, cJSON_GetObjectItem(root, "nodes")) {
      const char* s = cJSON_GetStringValue(cJSON_GetObjectItem(n, "sku"));
      if (!s) continue;
      if (!std::strcmp(s, me)) mine = n;
      std::function<void(const cJSON*, const std::string&)> walk = [&](const cJSON* g, const std::string& at) {
        const cJSON* k = nullptr;
        cJSON_ArrayForEach(k, cJSON_GetObjectItem(g, "children")) {
          const char* nm = cJSON_GetStringValue(cJSON_GetObjectItem(k, "name"));
          if (!nm) continue;
          const std::string p = at.empty() ? nm : at + "/" + nm;
          const char* kind = cJSON_GetStringValue(cJSON_GetObjectItem(k, "kind"));
          if (kind && !std::strcmp(kind, "group")) {
            walk(k, p);
            continue;
          }
          P x;
          if (const char* t = cJSON_GetStringValue(cJSON_GetObjectItem(k, "type"))) x.type = t;
          const cJSON* r = cJSON_GetObjectItem(k, "range");
          const cJSON *a = cJSON_GetObjectItem(r, "min"), *b = cJSON_GetObjectItem(r, "max");
          if (cJSON_IsNumber(a) && cJSON_IsNumber(b) && b->valuedouble != a->valuedouble) {
            x.lo = a->valuedouble;
            x.hi = b->valuedouble;
          }
          world[s][p] = x;
        }
      };
      walk(cJSON_GetObjectItem(n, "params"), "");
    }
    const cJSON* c = nullptr;
    std::map<std::string, int> sources;
    cJSON_ArrayForEach(c, cJSON_GetObjectItem(mine, "connections")) {
      const char* dest = cJSON_GetStringValue(cJSON_GetObjectItem(c, "dest"));
      const char* from = cJSON_GetStringValue(cJSON_GetObjectItem(c, "sku"));
      const char* src = cJSON_GetStringValue(cJSON_GetObjectItem(c, "source"));
      if (!dest || !from || !src || !declared_triggers.count(dest)) continue;
      ++sources[dest];
      const auto w = world.find(from);
      const std::map<std::string, P> none;
      const auto& tree = w == world.end() ? none : w->second;
      const auto p = tree.find(src);
      P one;
      if (p != tree.end()) one = p->second;
      else {
        // one element of an array
        const std::string sp = src;
        const size_t cut = sp.rfind('/');
        const auto arr = cut == std::string::npos ? tree.end() : tree.find(sp.substr(0, cut));
        if (arr != tree.end() && arr->second.type == "array") one = arr->second;
      }
      if (one.type == "trigger" || one.type == "string" || one.type == "blob") continue;
      Gate g;
      g.sku = from;
      g.path = src;
      g.is_bool = one.type == "bool";
      g.unknown = one.type.empty();
      g.lo = one.lo;
      g.hi = one.hi;
      g.invert = gate_invert.count(std::string(dest) + "\n" + from + "\n" + src) > 0;
      for (const auto& o : had[dest])
        if (o.sku == g.sku && o.path == g.path && o.invert == g.invert) g.on = o.on;
      gates[dest].push_back(std::move(g));
    }
    for (const auto& [dest, list] : gates)
      if (int(list.size()) == sources[dest]) gate_pure.insert(dest);
    cJSON_Delete(root);
  }

  // Where a gate's source stands now (-1 : no value known)
  int gate_now(const Gate& g, std::map<std::string, std::vector<df_world_param>>& seen) {
    auto it = seen.find(g.sku);
    if (it == seen.end()) {
      std::vector<df_world_param> list(df_world_params(node, g.sku.c_str(), nullptr, 0));
      if (!list.empty()) list.resize(std::min(list.size(), df_world_params(node, g.sku.c_str(), list.data(), list.size())));
      it = seen.emplace(g.sku, std::move(list)).first;
    }
    for (const auto& p : it->second) {
      if (p.is_group || g.path != p.path) continue;
      double v = 0;
      switch (p.value.type) {
        case DF_BOOL: v = p.value.b ? 1 : 0; break;
        case DF_NUMBER: v = (p.value.n - g.lo) / (g.hi - g.lo); break;
        case DF_V2:
        case DF_V3:
        case DF_V4: v = p.value.v[0]; break;
        case DF_COLOUR: v = p.value.rgba[0] / 255.0; break;
        default: return -1;
      }
      return (v >= 0.5) != g.invert ? 1 : 0;
    }
    return -1;
  }

  void triggers() {
    if (fired.empty()) return;
    if (gates_stale) read_gates();
    std::map<std::string, std::vector<df_world_param>> seen;
    for (auto& [path, times] : fired) {
      auto g = gates.find(path);
      int out = times;
      if (g != gates.end()) {
        int rose = 0, moved = 0;
        bool unknown = false;
        for (auto& x : g->second) {
          // what it is is not known yet : what it sends as it is met is its state, not
          // an event
          if (x.unknown) {
            unknown = true;
            continue;
          }
          const int now = gate_now(x, seen);
          if (now < 0) continue;
          if (x.on >= 0 && now == x.on && x.is_bool && g->second.size() == 1 && times >= 2) {
            // on and off (or off and on) within one poll : it rose once
            ++rose;
          } else if (x.on == 0 && now == 1) {
            ++rose;
          }
          if (now != x.on) ++moved;
          x.on = now;
        }
        // what else fired it (a trigger wired too, a hand on the mesh)
        const bool others = !gate_pure.count(path);
        out = rose;
        if (others && rose == 0 && moved == 0 && !unknown) out = times;
        if (unknown) gates_stale = true;
      }
      if (out <= 0) continue;
      Event e;
      e.kind = Event::Fire;
      e.path = path;
      e.n[0] = out;
      say(std::move(e));
    }
    fired.clear();
  }

  // ── commands (on the thread) ──
  void set(const std::string& path, const Value& v) {
    switch (v.kind) {
      case Value::Bool: df_set_bool(node, path.c_str(), v.b); break;
      case Value::Number: df_set_number(node, path.c_str(), v.n); break;
      case Value::Text: df_set_string(node, path.c_str(), v.s.c_str()); break;
      case Value::List: {
        std::vector<float> f(v.list.begin(), v.list.end());
        df_set_array(node, path.c_str(), DF_ELEM_FLOAT, f.data(), f.size());
        break;
      }
      case Value::Null: {
        df_value u;
        std::memset(&u, 0, sizeof u);
        u.type = DF_UNKNOWN;
        df_set(node, path.c_str(), &u);
        break;
      }
    }
    auto it = cold.find(path);
    if (it != cold.end() && !it->second.hot) look(path, it->second, false);  // (our own : no news)
  }

  void reply(double id, const char* kind, Value v) {
    Event e;
    e.kind = Event::Reply;
    e.n[0] = id;
    e.text = kind;
    e.value = std::move(v);
    say(std::move(e));
  }
  void reply(double id, bool ok) {
    Value v;
    v.kind = Value::Bool;
    v.b = ok;
    reply(id, "", std::move(v));
  }
  void reply_text(double id, std::string s) {
    Value v;
    v.kind = Value::Text;
    v.s = std::move(s);
    reply(id, "", std::move(v));
  }
  void reply_json(double id, cJSON* o) {
    char* t = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    Value v;
    v.kind = Value::Text;
    v.s = t ? t : "null";
    cJSON_free(t);
    reply(id, "json", std::move(v));
  }

  void call(double id, const std::string& op, const Args& a);
};

const char* str(const Args& a, size_t i) { return i < a.s.size() ? a.s[i].c_str() : ""; }
double num(const Args& a, size_t i, double d = 0) { return i < a.n.size() ? a.n[i] : d; }

cJSON* value_json(const df_value& v) {
  switch (v.type) {
    case DF_BOOL: return cJSON_CreateBool(v.b);
    case DF_NUMBER:
    case DF_TRIGGER:
    case DF_ARRAY: return cJSON_CreateNumber(v.n);
    case DF_V2:
    case DF_V3:
    case DF_V4: return cJSON_CreateFloatArray(v.v, v.type == DF_V2 ? 2 : v.type == DF_V3 ? 3 : 4);
    case DF_COLOUR: {
      const int c[4] = { v.rgba[0], v.rgba[1], v.rgba[2], v.rgba[3] };
      return cJSON_CreateIntArray(c, 4);
    }
    case DF_STRING:
    case DF_BLOB: return cJSON_CreateString(v.s);
    default: return cJSON_CreateNull();
  }
}

void Node::call(double id, const std::string& op, const Args& a) {
  if (op == "tree") {
    // the whole tree, as a config : what it lacks is removed, the rest declared again
    char why[256] = "";
    const bool ok = df_node_apply_json(node, str(a, 0), why, sizeof why);
    gates_stale = true;
    for (const auto& [p, v] : a.sets) set(p, v);  // (a new param's value : ours, not an event)
    Value v;
    v.kind = ok ? Value::Bool : Value::Text;
    v.b = ok;
    v.s = why;
    reply(id, "", std::move(v));
  } else if (op == "watch") {
    // every param of ours the mesh may set, as they are now
    std::map<std::string, Known> next;
    for (const auto& p : a.s) {
      Known k;
      const auto had = cold.find(p);
      if (had != cold.end()) k = had->second;
      else if (watched.count(p)) k.hot = true;
      else look(p, k, false);
      next.emplace(p, std::move(k));
    }
    cold = std::move(next);
  } else if (op == "triggers") {
    // which of ours are triggers; one that was not there starts its count over
    std::set<std::string> now(a.s.begin(), a.s.end());
    for (const auto& p : now)
      if (!declared_triggers.count(p)) trigger_last.erase(p);
    declared_triggers = std::move(now);
    gates_stale = true;
  } else if (op == "gateInvert") {
    gate_invert = std::set<std::string>(a.s.begin(), a.s.end());
    gates_stale = true;
  } else if (op == "set") {
    for (const auto& [p, v] : a.sets) set(p, v);
  } else if (op == "connect") {  // dest sku, dest, source sku, source
    reply(id, df_connect_remote(node, str(a, 0), str(a, 1), str(a, 2), str(a, 3)));
  } else if (op == "connectPick") {  // ... + by (1 id, 2 rank), value
    reply(id, df_connect_instance(node, str(a, 0), str(a, 1), str(a, 2), str(a, 3), num(a, 0) == 1 ? DF_PICK_ID : DF_PICK_RANK, num(a, 1)));
  } else if (op == "disconnect") {
    // ours : undone by this node's host; another's : asked of it
    if (!std::strcmp(str(a, 0), df_node_sku(node)) && num(a, 0) == 0) reply(id, df_disconnect(node, str(a, 1), str(a, 2), str(a, 3)));
    else reply(id, df_disconnect_remote(node, str(a, 0), str(a, 1), str(a, 2), str(a, 3)));
  } else if (op == "listen") {  // dest, name or sku, source
    reply(id, df_listen(node, str(a, 0), str(a, 1), str(a, 2), DF_PICK_NONE, 0));
  } else if (op == "transform") {  // dest, source sku, source
    reply(id, df_transform_set(node, str(a, 0), str(a, 1), str(a, 2), &a.transform));
  } else if (op == "world") {
    char* s = df_world_json(node);
    Value v;
    v.kind = Value::Text;
    v.s = s ? s : "{}";
    df_free(s);
    bool synced = false;
    reply(id, "world", std::move(v));
    (void)synced;
  } else if (op == "params") {  // each node's params, with their values (a light read)
    cJSON* o = cJSON_CreateObject();
    for (const auto& k : a.s) {
      std::vector<df_world_param> list(df_world_params(node, k.c_str(), nullptr, 0));
      if (!list.empty()) list.resize(std::min(list.size(), df_world_params(node, k.c_str(), list.data(), list.size())));
      cJSON* arr = cJSON_AddArrayToObject(o, k.c_str());
      for (const auto& p : list) {
        if (p.is_group || std::strlen(p.path) >= sizeof(p.path) - 1) continue;  // (a longer path is cut : not one to name)
        cJSON* x = cJSON_CreateArray();
        cJSON_AddItemToArray(x, cJSON_CreateString(p.path));
        cJSON_AddItemToArray(x, value_json(p.value));
        cJSON_AddItemToArray(x, cJSON_CreateNumber(p.type));
        cJSON_AddItemToArray(x, cJSON_CreateNumber(p.min.type == DF_NUMBER ? p.min.n : 0));
        cJSON_AddItemToArray(x, cJSON_CreateNumber(p.max.type == DF_NUMBER ? p.max.n : 0));
        cJSON_AddItemToArray(x, cJSON_CreateNumber(p.epoch));
        cJSON_AddItemToArray(arr, x);
      }
    }
    reply_json(id, o);
  } else if (op == "own") {  // our params' own state : value, destination, who listens
    cJSON* o = cJSON_CreateObject();
    for (const auto& k : a.s) {
      cJSON* x = cJSON_AddObjectToObject(o, k.c_str());
      df_value v;
      if (df_get(node, k.c_str(), &v)) {
        if (v.type == DF_ARRAY) {
          float f[256];
          const long c = df_get_array(node, k.c_str(), DF_ELEM_FLOAT, f, 256);
          cJSON_AddItemToObject(x, "value", c > 0 ? cJSON_CreateFloatArray(f, int(std::min<long>(c, 256))) : cJSON_CreateNull());
        } else {
          cJSON_AddItemToObject(x, "value", value_json(v));
        }
      }
      const size_t n = df_listeners(node, k.c_str(), nullptr, 0);
      if (n) {
        std::vector<df_listener> l(n);
        l.resize(std::min(n, df_listeners(node, k.c_str(), l.data(), n)));
        cJSON* arr = cJSON_AddArrayToObject(x, "to");
        for (const auto& t : l) {
          cJSON* y = cJSON_CreateArray();
          cJSON_AddItemToArray(y, cJSON_CreateString(t.sku));
          cJSON_AddItemToArray(y, cJSON_CreateString(t.node));
          cJSON_AddItemToArray(y, cJSON_CreateString(t.path));
          cJSON_AddItemToArray(arr, y);
        }
      }
    }
    reply_json(id, o);
  } else if (op == "state") {  // the mesh's own state
    cJSON* o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "discovery", df_node_discovery_status(node));
    cJSON_AddBoolToObject(o, "halted", df_halted(node));
    cJSON_AddBoolToObject(o, "presentation", df_presentation(node));
    bool synced = false;
    const double t = df_mesh_time(node, &synced);
    cJSON_AddNumberToObject(o, "meshMs", t);
    cJSON_AddBoolToObject(o, "synced", synced);
    cJSON* u = cJSON_AddArrayToObject(o, "universes");
    char name[33];
    for (size_t i = 0; i < df_universe_count(node); ++i)
      if (df_universe_at(node, i, name)) cJSON_AddItemToArray(u, cJSON_CreateString(name));
    // how the streams of the nodes named arrive here
    cJSON* ls = cJSON_AddObjectToObject(o, "links");
    for (const auto& k : a.s) {
      df_link l;
      if (!df_link_stats(node, k.c_str(), &l)) continue;
      cJSON* x = cJSON_CreateArray();
      cJSON_AddItemToArray(x, cJSON_CreateNumber(l.received));
      cJSON_AddItemToArray(x, cJSON_CreateNumber(l.lost));
      cJSON_AddItemToArray(x, cJSON_CreateNumber(l.late));
      cJSON_AddItemToArray(x, cJSON_CreateNumber(l.latency_ms));
      cJSON_AddItemToObject(ls, k.c_str(), x);
    }
    reply_json(id, o);
  } else if (op == "setRemote") {  // sku, path, how ("bool" "number" "string" "v" "colour" "fire" "array"), the value
    const char* sku_ = str(a, 0);
    const char* path = str(a, 1);
    const std::string how = str(a, 2);
    df_value v;
    std::memset(&v, 0, sizeof v);
    bool ok = false;
    if (how == "array") {
      std::vector<float> f;
      if (a.value.kind == Value::List) f.assign(a.value.list.begin(), a.value.list.end());
      ok = !f.empty() && df_set_remote_array(node, sku_, path, DF_ELEM_FLOAT, f.data(), f.size());
    } else if (how == "string") {
      ok = df_set_remote_bytes(node, sku_, path, DF_STRING, a.value.s.data(), a.value.s.size());
    } else {
      if (how == "bool") { v.type = DF_BOOL; v.b = a.value.kind == Value::Bool ? a.value.b : a.value.n != 0; ok = true; }
      else if (how == "number") { v.type = DF_NUMBER; v.n = a.value.kind == Value::Bool ? a.value.b : a.value.n; ok = true; }
      else if (how == "fire") { v.type = DF_TRIGGER; ok = true; }
      else if (how == "colour" && a.value.kind == Value::List && a.value.list.size() >= 3) {
        v.type = DF_COLOUR;
        v.rgba[3] = 255;
        for (size_t i = 0; i < 4 && i < a.value.list.size(); ++i) v.rgba[i] = uint8_t(std::clamp(a.value.list[i] + 0.5, 0.0, 255.0));
        ok = true;
      } else if (how == "v" && a.value.kind == Value::List && a.value.list.size() >= 2 && a.value.list.size() <= 4) {
        v.type = a.value.list.size() == 2 ? DF_V2 : a.value.list.size() == 3 ? DF_V3 : DF_V4;
        for (size_t i = 0; i < a.value.list.size(); ++i) v.v[i] = float(a.value.list[i]);
        ok = true;
      }
      ok = ok && df_set_remote(node, sku_, path, &v);
    }
    reply(id, ok);
  } else if (op == "forget") {
    reply(id, df_forget(node, str(a, 0)));
  } else if (op == "forgetOffline") {
    Value v;
    v.kind = Value::Number;
    v.n = double(df_forget_offline(node, num(a, 0) != 0));
    reply(id, "", std::move(v));
  } else if (op == "scene") {  // "recall" | "store", slot
    reply(id, std::string(str(a, 0)) == "store" ? df_scene_store(node, int(num(a, 0))) : df_scene_recall(node, int(num(a, 0))));
  } else if (op == "presentation") {
    df_set_presentation(node, num(a, 0) != 0);
  } else if (op == "locate") {
    reply(id, df_locate(node, str(a, 0), str(a, 1), uint32_t(std::clamp(num(a, 0), 0.0, 60000.0))));
  } else if (op == "identify") {
    df_identify(node);
  } else if (op == "halt") {
    df_halt(node, num(a, 0) != 0);
  } else if (op == "monitor") {
    df_monitor(node, num(a, 0) != 0);
  } else if (op == "stats") {
    cJSON* o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "polls", double(polls));
    cJSON_AddNumberToObject(o, "pollAvg", polls ? poll_sum / double(polls) : 0);
    cJSON_AddNumberToObject(o, "pollMax", poll_max);
    cJSON_AddNumberToObject(o, "lateAvg", polls ? late_sum / double(polls) : 0);
    cJSON_AddNumberToObject(o, "lateMax", late_max);
    cJSON_AddNumberToObject(o, "lateOver5", double(late_over_5));
    cJSON_AddNumberToObject(o, "lateOver10", double(late_over_10));
    polls = late_over_5 = late_over_10 = 0;
    poll_sum = poll_max = late_sum = late_max = 0;
    reply_json(id, o);
  } else {
    reply(id, false);
  }
}

// ── JavaScript's side ──────────────────────────────────────────────────────

std::map<uint32_t, std::unique_ptr<Node>> nodes;
uint32_t next_handle = 1;

bool get_string(napi_env e, napi_value v, std::string& out, size_t max) {
  napi_valuetype t;
  if (napi_typeof(e, v, &t) != napi_ok || t != napi_string) return false;
  size_t n = 0;
  if (napi_get_value_string_utf8(e, v, nullptr, 0, &n) != napi_ok || n > max) return false;
  out.resize(n + 1);
  if (napi_get_value_string_utf8(e, v, out.data(), n + 1, &n) != napi_ok) return false;
  out.resize(n);
  return out.find('\0') == std::string::npos;  // a C string on the other side
}
bool good_path(const std::string& s) {
  if (s.empty() || s.size() > kMaxPath) return false;
  for (const char c : s)
    if (static_cast<unsigned char>(c) < 0x20) return false;
  return true;
}
napi_value J(napi_env e, double d) { napi_value v; napi_create_double(e, d, &v); return v; }
napi_value J(napi_env e, bool b) { napi_value v; napi_get_boolean(e, b, &v); return v; }
napi_value J(napi_env e, const std::string& s) {
  napi_value v;
  napi_create_string_utf8(e, s.data(), s.size(), &v);
  return v;
}
napi_value JNull(napi_env e) { napi_value v; napi_get_null(e, &v); return v; }
napi_value J(napi_env e, const Value& x) {
  switch (x.kind) {
    case Value::Bool: return J(e, x.b);
    case Value::Number: return J(e, x.n);
    case Value::Text: return J(e, x.s);
    case Value::List: {
      napi_value a;
      napi_create_array_with_length(e, x.list.size(), &a);
      for (size_t i = 0; i < x.list.size(); ++i) napi_set_element(e, a, uint32_t(i), J(e, x.list[i]));
      return a;
    }
    default: return JNull(e);
  }
}
void put(napi_env e, napi_value o, const char* k, napi_value v) { napi_set_named_property(e, o, k, v); }
napi_value get(napi_env e, napi_value o, const char* k) {
  napi_value v;
  return napi_get_named_property(e, o, k, &v) == napi_ok ? v : nullptr;
}

// A value : bool, finite number, string, list of finite numbers (a typed array too), null
bool get_value(napi_env e, napi_value v, Value& out) {
  napi_valuetype t;
  if (napi_typeof(e, v, &t) != napi_ok) return false;
  switch (t) {
    case napi_boolean: out.kind = Value::Bool; return napi_get_value_bool(e, v, &out.b) == napi_ok;
    case napi_number: out.kind = Value::Number; return napi_get_value_double(e, v, &out.n) == napi_ok && std::isfinite(out.n);
    case napi_string: out.kind = Value::Text; return get_string(e, v, out.s, kMaxText);
    case napi_null: out.kind = Value::Null; return true;
    case napi_object: {
      bool is = false;
      napi_is_array(e, v, &is);
      if (!is) return false;
      uint32_t n = 0;
      napi_get_array_length(e, v, &n);
      if (n > 8192) return false;
      out.kind = Value::List;
      for (uint32_t i = 0; i < n; ++i) {
        napi_value x;
        double d = 0;
        if (napi_get_element(e, v, i, &x) != napi_ok || napi_get_value_double(e, x, &d) != napi_ok || !std::isfinite(d)) return false;
        out.list.push_back(d);
      }
      return true;
    }
    default: return false;
  }
}

Node* node_of(napi_env e, napi_value v) {
  uint32_t h = 0;
  if (napi_get_value_uint32(e, v, &h) != napi_ok) return nullptr;
  auto it = nodes.find(h);
  return it == nodes.end() ? nullptr : it->second.get();
}

#define ARGS(k)        \
  size_t argc = k;     \
  napi_value argv[k];  \
  napi_get_cb_info(e, info, &argc, argv, nullptr, nullptr)

napi_value Version(napi_env e, napi_callback_info) {
  int a = 0, b = 0;
  df_api_version(&a, &b);
  napi_value o;
  napi_create_object(e, &o);
  put(e, o, "core", J(e, std::string(df_core_version())));
  put(e, o, "api", J(e, std::to_string(a) + "." + std::to_string(b)));
  return o;
}

napi_value SkuFromSeed(napi_env e, napi_callback_info info) {
  ARGS(1);
  std::string s;
  if (argc < 1 || !get_string(e, argv[0], s, 1024)) return JNull(e);
  char out[37];
  df_sku_from_seed(s.c_str(), out);
  return J(e, std::string(out));
}

napi_value Feature(napi_env e, napi_callback_info info) {
  ARGS(1);
  std::string s;
  return J(e, argc >= 1 && get_string(e, argv[0], s, 64) && df_has_feature(s.c_str()));
}

void CallJs(napi_env e, napi_value fn, void*, void*) {
  if (!e || !fn) return;
  napi_value undefined, r;
  napi_get_undefined(e, &undefined);
  napi_call_function(e, undefined, fn, 0, nullptr, &r);
}

// open({ name, sku, product, universe, dir, config, pollMs }, onWake) → a handle, or 0.
// The node starts on its thread and says so ("started" or "failed"); it polls only
// once go() is called.
napi_value Open(napi_env e, napi_callback_info info) {
  ARGS(2);
  if (argc < 2) return J(e, 0.0);
  auto n = std::make_unique<Node>();
  auto field = [&](const char* k, std::string& out, size_t max) {
    napi_value v = get(e, argv[0], k);
    return v && get_string(e, v, out, max);
  };
  if (!field("name", n->name, 64) || !field("sku", n->sku, 36) || !field("product", n->product, 64) ||
      !field("universe", n->universe, 32) || !field("dir", n->dir, 4096) || !field("config", n->config, 16 << 20))
    return J(e, 0.0);
  double ms = 4;
  if (napi_value v = get(e, argv[0], "pollMs")) napi_get_value_double(e, v, &ms);
  n->poll_ms = int(std::clamp(ms, 1.0, 50.0));
  napi_value label;
  napi_create_string_utf8(e, "dataflou", NAPI_AUTO_LENGTH, &label);
  // (one call waiting at most : a wake only says "drain")
  if (napi_create_threadsafe_function(e, argv[1], nullptr, label, 4, 1, nullptr, nullptr, nullptr, CallJs, &n->wake) != napi_ok) return J(e, 0.0);
  napi_unref_threadsafe_function(e, n->wake);  // the app quits when it wants to
  const uint32_t h = next_handle++;
  n->start_thread();
  nodes[h] = std::move(n);
  return J(e, double(h));
}

napi_value Go(napi_env e, napi_callback_info info) {
  ARGS(1);
  Node* n = argc >= 1 ? node_of(e, argv[0]) : nullptr;
  if (n) {
    {
      std::lock_guard<std::mutex> l(n->m);
      n->go = true;
    }
    n->cv.notify_one();
  }
  return J(e, n != nullptr);
}

void drop(Node& n) {
  n.close();  // the node leaves the mesh, its thread ends
  if (n.wake) napi_release_threadsafe_function(n.wake, napi_tsfn_abort);
  n.wake = nullptr;
}

napi_value Close(napi_env e, napi_callback_info info) {
  ARGS(1);
  uint32_t h = 0;
  if (argc < 1 || napi_get_value_uint32(e, argv[0], &h) != napi_ok) return J(e, false);
  auto it = nodes.find(h);
  if (it == nodes.end()) return J(e, false);
  drop(*it->second);
  nodes.erase(it);
  return J(e, true);
}

napi_value Drain(napi_env e, napi_callback_info info) {
  ARGS(1);
  napi_value out;
  napi_create_array(e, &out);
  Node* n = argc >= 1 ? node_of(e, argv[0]) : nullptr;
  if (!n) return out;
  std::vector<Event> list;
  n->woken = false;
  {
    std::lock_guard<std::mutex> l(n->em);
    list.swap(n->events);
    n->newest.clear();
    n->newest_fire.clear();
  }
  static const char* const names[] = { "value", "fire", "dest", "locate", "halt", "peer", "scene", "topology", "log", "reply", "started", "failed", "params" };
  uint32_t i = 0;
  for (const auto& x : list) {
    napi_handle_scope hs;
    napi_open_handle_scope(e, &hs);
    napi_value o;
    napi_create_object(e, &o);
    put(e, o, "k", J(e, std::string(names[x.kind])));
    switch (x.kind) {
      case Event::Val: put(e, o, "path", J(e, x.path)); put(e, o, "value", J(e, x.value)); break;
      case Event::Fire: put(e, o, "path", J(e, x.path)); put(e, o, "times", J(e, x.n[0])); break;
      case Event::Dest:
        put(e, o, "path", J(e, x.path));
        put(e, o, "state", J(e, x.n[0]));
        put(e, o, "origin", J(e, x.n[1]));
        put(e, o, "connections", J(e, x.n[2]));
        put(e, o, "live", J(e, x.n[3]));
        break;
      case Event::Locate: put(e, o, "path", J(e, x.path)); put(e, o, "on", J(e, x.n[0] != 0)); break;
      case Event::Halt: put(e, o, "on", J(e, x.n[0] != 0)); break;
      case Event::Peer: put(e, o, "sku", J(e, x.path)); put(e, o, "label", J(e, x.text)); put(e, o, "joined", J(e, x.n[0] != 0)); break;
      case Event::Scene:
        put(e, o, "op", J(e, x.n[0]));
        put(e, o, "slot", J(e, x.n[1]));
        put(e, o, "state", J(e, x.n[2]));
        put(e, o, "skipped", J(e, x.n[3]));
        put(e, o, "current", J(e, x.n[4]));
        put(e, o, "slots", J(e, x.n[5]));
        break;
      case Event::Reply: put(e, o, "id", J(e, x.n[0])); put(e, o, "as", J(e, x.text)); put(e, o, "value", J(e, x.value)); break;
      case Event::Started: put(e, o, "port", J(e, x.n[0])); break;
      case Event::Log:
      case Event::Failed: put(e, o, "text", J(e, x.text)); break;
      default: break;
    }
    napi_set_element(e, out, i++, o);
    napi_close_handle_scope(e, hs);
  }
  return out;
}

// call(handle, id, op, { s: [strings], n: [numbers], value, sets: [[path, value]], axes })
napi_value Call(napi_env e, napi_callback_info info) {
  ARGS(4);
  Node* n = argc >= 3 ? node_of(e, argv[0]) : nullptr;
  if (!n) return J(e, false);
  double id = 0;
  napi_get_value_double(e, argv[1], &id);
  std::string op;
  if (!get_string(e, argv[2], op, 32)) return J(e, false);
  auto a = std::make_shared<Args>();
  napi_valuetype t = napi_undefined;
  if (argc >= 4) napi_typeof(e, argv[3], &t);
  if (t == napi_object) {
    auto list = [&](const char* k, auto&& each) {
      napi_value v = get(e, argv[3], k);
      bool is = false;
      if (!v || napi_is_array(e, v, &is) != napi_ok || !is) return true;
      uint32_t len = 0;
      napi_get_array_length(e, v, &len);
      for (uint32_t i = 0; i < len; ++i) {
        napi_handle_scope hs;
        napi_open_handle_scope(e, &hs);
        napi_value x;
        const bool ok = napi_get_element(e, v, i, &x) == napi_ok && each(x);
        napi_close_handle_scope(e, hs);
        if (!ok) return false;
      }
      return true;
    };
    bool ok = list("s", [&](napi_value x) {
      std::string s;
      if (!get_string(e, x, s, 16 << 20)) return false;
      // (a tree's JSON is the only long one; a path the core would not take is refused here)
      if (op != "tree" && s.size() > kMaxPath * 4) return false;
      a->s.push_back(std::move(s));
      return true;
    });
    ok = ok && list("n", [&](napi_value x) {
      double d = 0;
      if (napi_get_value_double(e, x, &d) != napi_ok || !std::isfinite(d)) return false;
      a->n.push_back(d);
      return true;
    });
    // (one bad value is left out : the others of the frame still go)
    ok = ok && list("sets", [&](napi_value x) {
      napi_value p, v;
      std::string path;
      Value val;
      if (napi_get_element(e, x, 0, &p) == napi_ok && napi_get_element(e, x, 1, &v) == napi_ok && get_string(e, p, path, kMaxPath) && good_path(path) && get_value(e, v, val))
        a->sets.emplace_back(std::move(path), std::move(val));
      return true;
    });
    if (napi_value v = get(e, argv[3], "value")) {
      Value val;
      napi_valuetype vt;
      napi_typeof(e, v, &vt);
      if (vt != napi_undefined) {
        if (!get_value(e, v, val)) ok = false;
        a->value = std::move(val);
      }
    }
    // a link's transform : [{ in: [a, b], out: [a, b], curve: [[x, y]...], free }]
    a->transform.size = sizeof(df_transform);
    ok = ok && list("axes", [&](napi_value x) {
      if (a->transform.axes >= 4) return true;
      df_axis ax;
      std::memset(&ax, 0, sizeof ax);
      auto pair = [&](napi_value v, double& lo, double& hi) {
        bool is = false;
        if (!v || napi_is_array(e, v, &is) != napi_ok || !is) return false;
        napi_value p, q;
        return napi_get_element(e, v, 0, &p) == napi_ok && napi_get_element(e, v, 1, &q) == napi_ok && napi_get_value_double(e, p, &lo) == napi_ok &&
               napi_get_value_double(e, q, &hi) == napi_ok && std::isfinite(lo) && std::isfinite(hi);
      };
      ax.in_set = pair(get(e, x, "in"), ax.in_min, ax.in_max);
      ax.out_set = pair(get(e, x, "out"), ax.out_min, ax.out_max);
      napi_value c = get(e, x, "curve");
      bool is = false;
      if (c && napi_is_array(e, c, &is) == napi_ok && is) {
        uint32_t len = 0;
        napi_get_array_length(e, c, &len);
        for (uint32_t i = 0; i < len && ax.points < DF_CURVE_POINTS; ++i) {
          napi_value p;
          double px = 0, py = 0;
          if (napi_get_element(e, c, i, &p) != napi_ok || !pair(p, px, py)) return false;
          ax.x[ax.points] = float(px);
          ax.y[ax.points] = float(py);
          ++ax.points;
        }
      }
      napi_value f = get(e, x, "free");
      if (f) napi_get_value_bool(e, f, &ax.free);
      a->transform.axis[a->transform.axes++] = ax;
      return true;
    });
    if (!ok) return J(e, false);
  }
  n->post([n, id, op, a] { n->call(id, op, *a); });
  return J(e, true);
}

void AtExit(void*) {
  // (the environment goes : every node leaves the mesh, its thread ended)
  for (auto& [h, n] : nodes) drop(*n);
  nodes.clear();
}

napi_value Init(napi_env e, napi_value exports) {
  const std::pair<const char*, napi_callback> fns[] = { { "version", Version }, { "skuFromSeed", SkuFromSeed }, { "feature", Feature }, { "open", Open },
                                                        { "go", Go }, { "close", Close }, { "drain", Drain }, { "call", Call } };
  for (const auto& [name, fn] : fns) {
    napi_value f;
    napi_create_function(e, name, NAPI_AUTO_LENGTH, fn, nullptr, &f);
    napi_set_named_property(e, exports, name, f);
  }
  napi_add_env_cleanup_hook(e, AtExit, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(dataflou, Init)
