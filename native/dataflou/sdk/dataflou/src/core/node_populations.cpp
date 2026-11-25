// node_populations.cpp — populations of ours fed by others' (9.1): which
// instance holds each slot, and the edges of its life (open, commit,
// release, close, relate), decided here for every host alike. Populations
// nest: an instance's slot may hold a population of its own (a cluster's
// touches, an MPE zone's voices), whose instances live within it. The life
// of an instance is a transition table run by etl::state_chart.
// docs/couches.md, "La connexion poly" and "Vies d'instances".

#include "node_internal.h"
#include <etl/state_chart.h>

namespace dataflou {

namespace {

constexpr uint8_t kParts = 6;   // a link's parts: its populations' paths, then its param

bool truthy(const ParamValue& v) {
    switch (v.tag) {
    case ParamType::Bool:   return v.b;
    case ParamType::Number: return v.n >= 0.5;
    default:                return false;
    }
}

double numeric(const ParamValue& v) {
    switch (v.tag) {
    case ParamType::Bool:   return v.b ? 1.0 : 0.0;
    case ParamType::Number: return v.n;
    default:                return 0.0;
    }
}

// What a reason param says: a name ("cancel") or an EndReason number
EndReason reason_of(const ParamValue& v) {
    if (v.tag == ParamType::String) return parse_reason(v.s.c_str());
    const double n = numeric(v);
    return n >= 1 && n <= static_cast<double>(EndReason::Split) ? static_cast<EndReason>(static_cast<int>(n))
                                                                : EndReason::None;
}

void slot_path(const Text& pop, uint8_t slot, const char* rel, Text& out) {
    char k[4];
    snprintf(k, sizeof(k), "%u", static_cast<unsigned>(slot));
    Text g;
    join_path(pop.c_str(), k, g);
    join_path(g.c_str(), rel, out);
}

// A param of a population's template with that role (or the gate by name);
// a population nested in the template has its own
bool template_has(const ParamNode* pop, ParamRole role) {
    if (!pop || pop->children.empty()) return false;
    struct Walk {
        static bool any(const ParamNode* n, ParamRole r) {
            for (const auto* c : n->children) {
                if (c->meta.kind != ParamKind::Param) {
                    if (c->meta.slots == 0 && any(c, r)) return true;
                    continue;
                }
                if (c->meta.role == r) return true;
                if (r == ParamRole::Gate && c->meta.role == ParamRole::None && c->meta.name == "on" &&
                    c->meta.type == ParamType::Bool)
                    return true;
            }
            return false;
        }
    };
    return Walk::any(pop->children[0], role);
}

// A link's path split at its populations: "cluster/*/touch/*/xy" gives
// ["cluster", "touch", "xy"]; the last part is the param under the innermost
uint8_t split_levels(const char* rel, Text* parts, uint8_t max_parts) {
    uint8_t n = 0;
    Text cur;
    const char* p = rel;
    while (*p && n + 1 < max_parts) {
        const char* slash = std::strchr(p, '/');
        const size_t len = slash ? static_cast<size_t>(slash - p) : std::strlen(p);
        if (len == 1 && *p == '*') {
            parts[n++] = cur;
            cur.clear();
        } else {
            Text comp(p, len);
            Text joined;
            join_path(cur.c_str(), comp.c_str(), joined);
            cur = joined;
        }
        p = slash ? slash + 1 : p + len;
    }
    parts[n++] = cur;
    return n;
}

} // namespace

// --- An instance's life ---
//
//   free      --gate up-->               tentative (a commit param in the template) | open
//   tentative --commit-->                open
//   tentative --gate down-->             released (held) | free     failed, or what it says
//   open      --gate down-->             released (held) | free     done, or what it says
//   tentative, open --new id-->          the same: the one before closes, the next opens
//   released  --hold out | close-->      free                       destination, done
//   tentative, open --close-->           free                       destination, cancel (kept out)
//   any       --steal-->                 free                       destination, steal
//   tentative, open --lost-->            free                       lost, lost (grounds)
//   any       --cut-->                   free                       its end, cancel (grounds)
//   any       --outer-->                 free                       as its outer instance closed
//   free      --claim-->                 open (the host's)
//   open      --unclaim-->               free                       destination, done

struct Node::Life {
    enum State : uint8_t { Free, Tentative, Open, Released };
    enum Event : uint8_t { GateUp, GateDown, Commit, NewId, HoldOut, Close, Steal, Lost, Cut, Outer,
                           Claim, Unclaim };

    Node& n;
    Population& p;
    uint8_t slot;
    const InboundEntry* ie;
    uint64_t now;
    EndOrigin origin;               // Cut, Outer: who ended it
    EndReason reason;               // Outer: why

    Holder& h() { return p.slots[slot - 1]; }

    // Guards
    bool tentative() { return template_has(n.local_params_.resolve(p.path.c_str()), ParamRole::Commit); }
    bool held() {
        const ParamNode* pop = n.local_params_.resolve(p.path.c_str());
        return pop && pop->meta.hold >= 0.0f;
    }

    // Actions
    void open() {
        n.open_slot(p, slot, *ie, now);
        n.emit_instance(p, slot, Edge::Open);
    }
    void commit() {
        h().committed = true;
        n.emit_instance(p, slot, Edge::Commit);
    }
    EndReason said() {
        if (h().said != EndReason::None) return h().said;
        return h().committed ? EndReason::Done : EndReason::Failed;
    }
    void release_hold() {
        n.release_edge(p, slot, said(), now);
        const ParamNode* pop = n.local_params_.resolve(p.path.c_str());
        const float hold = pop ? pop->meta.hold : 0.0f;
        h().hold_until = hold > 0.0f ? now + static_cast<uint64_t>(hold * 1000.0f) : 0;
    }
    void release_close() {
        const EndReason r = said();
        n.release_edge(p, slot, r, now);
        n.close_slot(p, slot, EndOrigin::Source, r, false);
    }
    void renew() {
        // Another instance in the same source slot, its close lost on the way
        n.close_slot(p, slot, EndOrigin::Source, EndReason::Done, false);
        n.open_slot(p, slot, *ie, now);
        n.set_gate(p, slot, true);
        n.emit_instance(p, slot, Edge::Open);
    }
    void done_here() { n.close_slot(p, slot, EndOrigin::Destination, EndReason::Done, false); }
    void cancel_here() {
        n.evict(h().conn, h().chain, h().has_instance, h().instance);   // until its gate falls
        n.close_slot(p, slot, EndOrigin::Destination, EndReason::Cancel, false);
    }
    void steal() {
        if (!h().released) n.evict(h().conn, h().chain, h().has_instance, h().instance);
        n.close_slot(p, slot, EndOrigin::Destination, EndReason::Steal, false);
    }
    void lost() { n.close_slot(p, slot, EndOrigin::Lost, EndReason::Lost, true); }
    void cut() { n.close_slot(p, slot, origin, EndReason::Cancel, true); }
    void outer() { n.close_slot(p, slot, origin, reason, false); }
    void claim() {
        Holder& x = h();
        x = Holder{};
        x.used = x.open = x.host = x.committed = true;
        x.opened_ms = now;
        x.order = ++n.open_order_;
        n.emit_instance(p, slot, Edge::Open);
    }

    using Transition = etl::state_chart_traits::transition<Life>;
    static const Transition table[];
    struct Chart : etl::state_chart<Life> {
        Chart(Life& l, uint8_t at);
    };
};

const Node::Life::Transition Node::Life::table[] = {
    Transition(Free,      GateUp,   Tentative, &Life::open,          &Life::tentative),
    Transition(Free,      GateUp,   Open,      &Life::open),
    Transition(Tentative, Commit,   Open,      &Life::commit),
    Transition(Tentative, GateDown, Released,  &Life::release_hold,  &Life::held),
    Transition(Tentative, GateDown, Free,      &Life::release_close),
    Transition(Open,      GateDown, Released,  &Life::release_hold,  &Life::held),
    Transition(Open,      GateDown, Free,      &Life::release_close),
    Transition(Tentative, NewId,    Tentative, &Life::renew,         &Life::tentative),
    Transition(Tentative, NewId,    Open,      &Life::renew),
    Transition(Open,      NewId,    Tentative, &Life::renew,         &Life::tentative),
    Transition(Open,      NewId,    Open,      &Life::renew),
    Transition(Released,  HoldOut,  Free,      &Life::done_here),
    Transition(Released,  Close,    Free,      &Life::done_here),
    Transition(Tentative, Close,    Free,      &Life::cancel_here),
    Transition(Open,      Close,    Free,      &Life::cancel_here),
    Transition(Tentative, Steal,    Free,      &Life::steal),
    Transition(Open,      Steal,    Free,      &Life::steal),
    Transition(Released,  Steal,    Free,      &Life::steal),
    Transition(Tentative, Lost,     Free,      &Life::lost),
    Transition(Open,      Lost,     Free,      &Life::lost),
    Transition(Tentative, Cut,      Free,      &Life::cut),
    Transition(Open,      Cut,      Free,      &Life::cut),
    Transition(Released,  Cut,      Free,      &Life::cut),
    Transition(Tentative, Outer,    Free,      &Life::outer),
    Transition(Open,      Outer,    Free,      &Life::outer),
    Transition(Released,  Outer,    Free,      &Life::outer),
    Transition(Free,      Claim,    Open,      &Life::claim),
    Transition(Open,      Unclaim,  Free,      &Life::done_here),
};

Node::Life::Chart::Chart(Life& l, uint8_t at)
    : etl::state_chart<Life>(l, std::begin(table), std::end(table), nullptr, nullptr, at) {
    start(false);
}

void Node::live(Population& p, uint8_t slot, uint8_t event, const InboundEntry* ie, uint64_t now,
                EndOrigin origin) {
    if (slot == 0 || slot > p.slots.size()) return;
    Life life{*this, p, slot, ie, now, origin, EndReason::Cancel};
    Life::Chart chart(life, p.slots[slot - 1].life);
    chart.process_event(event);
    p.slots[slot - 1].life = chart.get_state_id();
}

// --- The tables ---

Node::Population* Node::population(const char* path) {
    for (auto& p : populations_)
        if (p.path == path) return &p;
    return nullptr;
}

uint16_t Node::population_index(const char* path) {
    for (size_t i = 0; i < populations_.size(); ++i)
        if (populations_[i].path == path) return static_cast<uint16_t>(i);
    Population* p = populations_.emplace_back();
    if (!p) return ParamSubscription::NONE;
    p->path = path;
    return static_cast<uint16_t>(populations_.size() - 1);
}

Node::Evicted* Node::evicted(const ConnectionId& conn, uint32_t chain) {
    for (auto& e : evicted_)
        if (e.conn == conn && e.chain == chain) return &e;
    return nullptr;
}

void Node::evict(const ConnectionId& conn, uint32_t chain, bool has_instance, double instance) {
    Evicted* e = evicted(conn, chain);
    if (!e) e = evicted_.emplace_back();
    if (!e) return;
    e->conn = conn;
    e->chain = chain;
    e->has_instance = has_instance;
    e->instance = instance;
}

// The slot for a new instance: `want` if free, else the first free, else
// by the population's policy: one in release gives way (the oldest), then
// the oldest open one (or the newest); or none. 0: none.
uint8_t Node::allocate(Population& p, uint8_t want, uint64_t now) {
    const ParamNode* pop = local_params_.resolve(p.path.c_str());
    if (!pop || pop->meta.slots == 0) return 0;
    if (p.slots.size() != pop->meta.slots) p.slots.resize(pop->meta.slots);
    if (p.slots.size() != pop->meta.slots) return 0;               // out of memory
    if (want >= 1 && want <= p.slots.size() && !p.slots[want - 1].open) return want;
    for (size_t j = 0; j < p.slots.size(); ++j)
        if (!p.slots[j].open) return static_cast<uint8_t>(j + 1);
    if (pop->meta.full == FullPolicy::Refuse) return 0;
    size_t pick = SIZE_MAX;
    for (size_t j = 0; j < p.slots.size(); ++j) {
        const Holder& h = p.slots[j];
        if (h.host) continue;                                       // the host's own stay
        if (pick == SIZE_MAX) { pick = j; continue; }
        const Holder& b = p.slots[pick];
        const bool newer = h.order > b.order;
        if (h.released != b.released ? h.released
                                      : (pop->meta.full == FullPolicy::Newest ? newer : !newer)) pick = j;
    }
    if (pick == SIZE_MAX) return 0;
    const uint8_t slot = static_cast<uint8_t>(pick + 1);
    live(p, slot, Life::Steal, nullptr, now);                       // it gives way
    return slot;
}

// What a param with a role says of its instance
void Node::take_role(Holder& h, ParamRole role, const ParamValue& v) {
    switch (role) {
    case ParamRole::Id:      h.has_instance = true; h.instance = numeric(v); break;
    case ParamRole::Key:     h.has_key = true; h.key = numeric(v); break;
    case ParamRole::Attack:  h.has_attack = true; h.attack = numeric(v); break;
    case ParamRole::Release: h.has_release = true; h.release_value = numeric(v); break;
    case ParamRole::Reason:  h.said = reason_of(v); break;
    case ParamRole::Parent:  h.has_parent = true; h.parent = numeric(v); break;
    case ParamRole::Confidence: h.has_confidence = true; h.confidence = numeric(v); break;
    default: break;
    }
}

// The leaf a link's value lands on in a slot of its innermost population
static void leaf_of(const Text& pop, uint8_t slot, const Link& l, Text& out) {
    Text parts[kParts];
    const uint8_t n = split_levels(l.dest.c_str(), parts, kParts);
    slot_path(pop, slot, parts[n - 1].c_str(), out);
}

void Node::open_slot(Population& p, uint8_t slot, const InboundEntry& ie, uint64_t now) {
    Holder& h = p.slots[slot - 1];
    h = Holder{};
    h.used = true;
    h.open = true;
    h.conn = ie.id;
    h.sku = ie.source_sku;
    h.chain = ie.chain_key();
    h.source_slot = ie.source_slot();
    h.source_pop = ie.source_pop;
    h.opened_ms = now;
    h.order = ++open_order_;
    h.committed = !template_has(local_params_.resolve(p.path.c_str()), ParamRole::Commit);
    // What came before its gate (values, its id) goes in first
    for (size_t i = pending_values_.size(); i > 0; --i) {
        Pending& pv = pending_values_[i - 1];
        if (pv.conn != ie.id || pv.chain != h.chain) continue;
        for (auto& other : inbound_stream_) {
            if (other.levels != ie.levels || other.id != ie.id || other.chain_key() != h.chain ||
                other.link != pv.link) continue;
            take_role(h, other.role, pv.value);
            if (other.role == ParamRole::Commit && truthy(pv.value)) h.committed = true;
            Text path;
            leaf_of(p.path, slot, connections_[other.conn].links[other.link], path);
            if (ParamNode* d = local_params_.resolve(path.c_str()))
                deliver_into(other, d, path.c_str(), pv.value, false, now);
            break;
        }
        pending_values_.erase(pending_values_.begin() + static_cast<ptrdiff_t>(i - 1));
    }
}

bool Node::is_gate_param(const ParamNode* c) {
    return c->meta.kind == ParamKind::Param &&
           (c->meta.role == ParamRole::Gate ||
            (c->meta.role == ParamRole::None && c->meta.name == "on" && c->meta.type == ParamType::Bool));
}

// A slot's gate, set here (an instance that ends without its source saying so)
void Node::set_gate(Population& p, uint8_t slot, bool on) {
    char k[4];
    snprintf(k, sizeof(k), "%u", static_cast<unsigned>(slot));
    Text group;
    join_path(p.path.c_str(), k, group);
    ParamNode* g = local_params_.resolve(group.c_str());
    if (!g) return;
    for (auto* c : g->children) {
        if (!is_gate_param(c) || c->value.b == on) continue;
        Text path;
        join_path(group.c_str(), c->meta.name.c_str(), path);
        ParamValue v;
        v.tag = ParamType::Bool;
        v.b = on;
        receive_value(c, path.c_str(), v, clock_.millis());
    }
}

// Its gate fell: the release edge (its close, or its hold, is the machine's)
void Node::release_edge(Population& p, uint8_t slot, EndReason reason, uint64_t now) {
    Holder& h = p.slots[slot - 1];
    h.released = true;
    h.released_ms = now;
    h.reason = reason;
    h.lost_at = 0;
    emit_instance(p, slot, Edge::Release);
}

// An instance ends: its gate falls (when it has one); lost or cut off, its
// params return to their init as their ground says; the instances within it
// end with it. Ended here (the destination), its source is told.
void Node::close_slot(Population& p, uint8_t slot, EndOrigin origin, EndReason reason, bool ground) {
    if (slot == 0 || slot > p.slots.size()) return;
    Holder& h = p.slots[slot - 1];
    if (!h.open) return;
    close_inner(p, slot, origin, reason);
    h.open = false;
    h.lost_at = 0;
    h.end = origin;
    h.reason = reason;
    set_gate(p, slot, false);
    char k[4];
    snprintf(k, sizeof(k), "%u", static_cast<unsigned>(slot));
    Text group;
    join_path(p.path.c_str(), k, group);
    if (ParamNode* g = local_params_.resolve(group.c_str()); g && ground) {
        struct Walk {
            static void each(Node* n, ParamNode* node, const char* prefix) {
                for (auto* c : node->children) {
                    Text path;
                    join_path(prefix, c->meta.name.c_str(), path);
                    if (c->meta.kind != ParamKind::Param) { each(n, c, path.c_str()); continue; }
                    if (!is_gate_param(c) && c->meta.grounds()) n->start_ground(c, path.c_str(), EndOrigin::None);
                }
            }
        };
        Walk::each(this, g, group.c_str());
    }
    emit_instance(p, slot, Edge::Close);
    if (origin == EndOrigin::Destination && !h.host && !h.conn.empty()) send_ended(h, reason);
    if (h.has_instance) orphan_children(h);
    h.used = false;
    h.released = false;
}

// The populations within a slot: their instances end with it
void Node::close_inner(const Population& p, uint8_t slot, EndOrigin origin, EndReason reason) {
    char k[8];
    snprintf(k, sizeof(k), "/%u/", static_cast<unsigned>(slot));
    Text prefix = p.path;
    prefix += k;
    const uint64_t now = clock_.millis();
    for (size_t i = 0; i < populations_.size(); ++i) {
        if (std::strncmp(populations_[i].path.c_str(), prefix.c_str(), prefix.size()) != 0) continue;
        for (size_t j = 0; j < populations_[i].slots.size(); ++j) {
            if (!populations_[i].slots[j].open) continue;
            Life life{*this, populations_[i], static_cast<uint8_t>(j + 1), nullptr, now, origin, reason};
            Life::Chart chart(life, populations_[i].slots[j].life);
            chart.process_event(Life::Outer);
            populations_[i].slots[j].life = chart.get_state_id();
        }
    }
}

void Node::emit_instance(const Population& p, uint8_t slot, Edge edge) {
    if (slot == 0 || slot > p.slots.size()) return;
    const Holder& h = p.slots[slot - 1];
    const uint64_t now = clock_.millis();
    log("%s/%u: %s%s%s", p.path.c_str(), static_cast<unsigned>(slot),
        edge == Edge::Open ? (h.committed ? "open" : "open (tentative)")
        : edge == Edge::Commit ? "commit" : edge == Edge::Release ? "release"
        : edge == Edge::Relate ? "relate" : "close",
        edge == Edge::Close ? " " : "", edge == Edge::Close ? to_string(h.reason) : "");
    if (!instance_cb_) return;
    InstanceEvent e;
    e.population = p.path.c_str();
    e.slot = slot;
    e.edge = edge;
    e.open = h.open;
    e.tentative = h.open && !h.committed;
    e.released = h.released;
    e.origin = edge == Edge::Close ? h.end : edge == Edge::Release ? EndOrigin::Source : EndOrigin::None;
    e.reason = edge == Edge::Close || edge == Edge::Release ? h.reason : EndReason::None;
    e.conn = h.conn;
    e.source_sku = h.sku.c_str();
    e.source_slot = h.source_slot;
    e.has_instance = h.has_instance;
    e.instance = h.instance;
    e.has_key = h.has_key;
    e.key = h.key;
    if (edge == Edge::Open) { e.has_value = h.has_attack; e.value = h.attack; }
    if (edge == Edge::Release || edge == Edge::Close) { e.has_value = h.has_release; e.value = h.release_value; }
    e.age_ms = h.opened_ms ? static_cast<double>(now - h.opened_ms) : 0.0;
    e.has_parent = h.has_parent;
    e.parent = h.parent;
    e.has_confidence = h.has_confidence;
    e.confidence = h.confidence;
    instance_cb_(e, instance_ctx_);
}

// A value for one link into populations: down through each level's live
// instance to its own population, where it opens, feeds or ends one
void Node::deliver_poly(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now) {
    if (ie.conn >= connections_.size()) return;
    const Connection& c = connections_[ie.conn];
    if (ie.link >= c.links.size()) return;
    // The live instance of the connection's source slots in a population
    auto live_slot = [](const Vector<Holder>& slots, const ConnectionId& conn, uint32_t chain) -> uint8_t {
        for (size_t j = 0; j < slots.size(); ++j) {
            const auto& h = slots[j];
            if (h.open && !h.released && !h.host && h.conn == conn && h.chain == chain)
                return static_cast<uint8_t>(j + 1);
        }
        return 0;
    };

    // Where it goes: the concrete population of each level (an outer one's
    // slot is the one its instance holds)
    Text parts[kParts];
    const uint8_t n = split_levels(c.links[ie.link].dest.c_str(), parts, kParts);
    Text prefix = c.dest;
    Text pop_path;
    uint8_t part = 0;
    for (uint8_t level = 0; level < ie.levels; ++level) {
        if (level == 0 && c.poly) pop_path = prefix;
        else {
            join_path(prefix.c_str(), parts[part].c_str(), pop_path);
            ++part;
        }
        if (level + 1 == ie.levels) break;
        Population* outer = population(pop_path.c_str());
        uint32_t key = 0;
        for (uint8_t i = 0; i <= level; ++i) key |= static_cast<uint32_t>(ie.chain[i]) << (8 * i);
        const uint8_t s = outer ? live_slot(outer->slots, ie.id, key) : 0;
        if (!s) return;                            // its outer instance isn't open: nothing to feed
        char k[4];
        snprintf(k, sizeof(k), "%u", static_cast<unsigned>(s));
        join_path(pop_path.c_str(), k, prefix);
    }
    (void)n;
    const uint16_t pi = population_index(pop_path.c_str());
    if (pi == ParamSubscription::NONE) return;
    Population& p = populations_[pi];
    const uint32_t chain = ie.chain_key();
    uint8_t slot = live_slot(p.slots, ie.id, chain);
    const bool alive = slot != 0;
    const bool gated = template_has(local_params_.resolve(p.path.c_str()), ParamRole::Gate);

    auto into = [&](uint8_t s) {
        Text path;
        leaf_of(p.path, s, c.links[ie.link], path);
        if (ParamNode* d = local_params_.resolve(path.c_str()))
            deliver_into(ie, d, path.c_str(), value, refresh, now);
    };
    auto pend = [&] {
        for (auto& pv : pending_values_)
            if (pv.conn == ie.id && pv.chain == chain && pv.link == ie.link) {
                pv.value = value;
                pv.at = now;
                return;
            }
        Pending* pv = pending_values_.emplace_back();
        if (!pv) return;
        pv->conn = ie.id;
        pv->chain = chain;
        pv->link = ie.link;
        pv->value = value;
        pv->at = now;
    };

    Evicted* out = evicted(ie.id, chain);
    if (ie.role == ParamRole::Gate) {
        const bool on = truthy(value);
        if (!on && out) out->conn = ConnectionId{};    // it ended: let it come back
        if (on && out) return;                         // gave way, refused, or closed here
        if (on && alive) { into(slot); return; }
        if (on) {
            slot = allocate(p, ie.source_slot(), now);
            if (!slot) {
                log("%s: full, an instance from %s refused", p.path.c_str(), ie.source_sku.c_str());
                bool has_id = false;
                double id = 0;
                for (const auto& pv : pending_values_)
                    for (const auto& other : inbound_stream_)
                        if (pv.conn == ie.id && pv.chain == chain && other.id == ie.id &&
                            other.chain_key() == chain && other.link == pv.link &&
                            other.role == ParamRole::Id) { has_id = true; id = numeric(pv.value); }
                evict(ie.id, chain, has_id, id);
                return;
            }
            live(p, slot, Life::GateUp, &ie, now);
            into(slot);
            return;
        }
        if (slot) {
            into(slot);
            live(p, slot, Life::GateDown, &ie, now);
        }
        return;
    }
    if (ie.role == ParamRole::Id && out) {
        // Kept out while it is the same instance; a new id is a new one
        if (out->has_instance && numeric(value) == out->instance) return;
        out->conn = ConnectionId{};
        out = nullptr;
    }
    if (out) return;
    if (!alive) {
        if (!gated && !refresh) {                      // no gate: its first value opens it
            slot = allocate(p, ie.source_slot(), now);
            if (!slot) return;
            pend();                                    // the open takes it in
            live(p, slot, Life::GateUp, &ie, now);
            return;
        }
        pend();                                        // before its gate
        return;
    }
    Holder& h = p.slots[slot - 1];
    if (ie.role == ParamRole::Id && h.has_instance && numeric(value) != h.instance) {
        pend();                                        // the next one's id, taken as it opens
        live(p, slot, Life::NewId, &ie, now);
        return;
    }
    const bool had_parent = h.has_parent;
    const double parent_was = h.parent;
    take_role(h, ie.role, value);
    into(slot);
    if (ie.role == ParamRole::Parent && (!had_parent || parent_was != h.parent))
        emit_instance(p, slot, Edge::Relate);       // it belongs elsewhere now
    if (ie.role == ParamRole::Commit && truthy(value) && !h.committed)
        live(p, slot, Life::Commit, &ie, now);
}

// An instance closed: the ones that named it as their parent (from the same
// source) belong to nothing now
void Node::orphan_children(const Holder& parent) {
    for (auto& p : populations_)
        for (size_t j = 0; j < p.slots.size(); ++j) {
            Holder& h = p.slots[j];
            if (!h.open || !h.has_parent || h.parent != parent.instance || !(h.sku == parent.sku)) continue;
            h.has_parent = false;
            emit_instance(p, static_cast<uint8_t>(j + 1), Edge::Relate);
        }
}

// Every instance from the mesh ends, cut off (the mesh-wide stop)
void Node::cut_instances(EndOrigin origin, uint64_t now) {
    for (auto& p : populations_)
        for (size_t j = 0; j < p.slots.size(); ++j)
            if (p.slots[j].open && !p.slots[j].host)
                live(p, static_cast<uint8_t>(j + 1), Life::Cut, nullptr, now, origin);
}

void Node::populations_lost(const char* sku, bool lost) {
    const uint64_t now = clock_.millis();
    for (auto& p : populations_)
        for (auto& h : p.slots)
            if (h.open && !h.released && !h.host && h.sku == sku) h.lost_at = lost ? (now ? now : 1) : 0;
}

void Node::poll_populations() {
    const uint64_t now = clock_.millis();
    for (size_t i = evicted_.size(); i > 0; --i)
        if (evicted_[i - 1].conn.empty())
            evicted_.erase(evicted_.begin() + static_cast<ptrdiff_t>(i - 1));
    for (size_t i = pending_values_.size(); i > 0; --i)
        if (now - pending_values_[i - 1].at > 1000)
            pending_values_.erase(pending_values_.begin() + static_cast<ptrdiff_t>(i - 1));
    for (size_t pi = 0; pi < populations_.size(); ++pi) {
        Population& p = populations_[pi];
        const ParamNode* pop = local_params_.resolve(p.path.c_str());
        const uint64_t grace = pop && pop->meta.grace_ms ? pop->meta.grace_ms : instance_grace_ms_;
        for (size_t j = 0; j < p.slots.size(); ++j) {
            const Holder& h = p.slots[j];
            const uint8_t slot = static_cast<uint8_t>(j + 1);
            if (h.open && h.lost_at && now - h.lost_at >= grace)
                live(p, slot, Life::Lost, nullptr, now);
            else if (h.open && h.released && h.hold_until && now >= h.hold_until)
                live(p, slot, Life::HoldOut, nullptr, now);   // its hold ran out
        }
    }
}

bool Node::instance(const char* population_path, uint8_t slot, InstanceEvent* out) const {
    const ParamNode* pop = local_params_.resolve(population_path);
    if (!pop || pop->meta.slots == 0 || slot == 0 || slot > pop->meta.slots) return false;
    *out = InstanceEvent{};
    out->population = population_path;
    out->slot = slot;
    const uint64_t now = clock_.millis();
    for (const auto& p : populations_) {
        if (p.path != population_path || slot > p.slots.size()) continue;
        const Holder& h = p.slots[slot - 1];
        out->edge = !h.open ? Edge::Close : h.released ? Edge::Release
                  : h.committed ? Edge::Commit : Edge::Open;
        out->open = h.open;
        out->tentative = h.open && !h.committed;
        out->released = h.released;
        out->origin = h.open ? EndOrigin::None : h.end;
        out->reason = h.open && !h.released ? EndReason::None : h.reason;
        out->conn = h.conn;
        out->source_sku = h.sku.c_str();
        out->source_slot = h.source_slot;
        out->has_instance = h.has_instance;
        out->instance = h.instance;
        out->has_key = h.has_key;
        out->key = h.key;
        out->age_ms = h.open && h.opened_ms ? static_cast<double>(now - h.opened_ms) : 0.0;
        out->has_parent = h.has_parent;
        out->parent = h.parent;
        out->has_confidence = h.has_confidence;
        out->confidence = h.confidence;
    }
    return true;
}

uint8_t Node::claim(const char* population_path) {
    const ParamNode* pop = local_params_.resolve(population_path);
    if (!pop || pop->meta.slots == 0) return 0;
    const uint16_t pi = population_index(population_path);
    if (pi == ParamSubscription::NONE) return 0;
    Population& p = populations_[pi];
    const uint64_t now = clock_.millis();
    const uint8_t slot = allocate(p, 0, now);
    if (!slot) return 0;
    live(p, slot, Life::Claim, nullptr, now);
    return slot;
}

bool Node::release(const char* population_path, uint8_t slot) {
    Population* p = population(population_path);
    if (!p || slot == 0 || slot > p->slots.size() || !p->slots[slot - 1].host) return false;
    live(*p, slot, Life::Unclaim, nullptr, clock_.millis());
    p->slots[slot - 1].host = false;
    return true;
}

bool Node::close_instance(const char* population_path, uint8_t slot) {
    Population* p = population(population_path);
    if (!p || slot == 0 || slot > p->slots.size()) return false;
    const Holder& h = p->slots[slot - 1];
    if (!h.open || h.host) return false;
    live(*p, slot, Life::Close, nullptr, clock_.millis());
    return true;
}

// The source learns that its instance ended here (ENDED)
void Node::send_ended(const Holder& h, EndReason reason) {
    const Connection* c = find_connection(h.conn);
    if (!c) return;
    MsgEnded m;
    m.source_path = h.source_pop.empty() ? c->source : h.source_pop;
    m.source_slot = h.source_slot;
    m.reason = reason;
    m.has_instance = h.has_instance;
    m.instance = h.instance;
    if (c->source_sku == identity_.sku) {              // our own population: told here
        handle_ended(identity_.sku.c_str(), m);
        return;
    }
    PeerConnection* peer = find_peer_by_sku(c->source_sku.c_str());
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE || !peer->hello_received) return;
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_ended(buf, ++seq_, m); });
    if (len > 0) send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
}

void Node::handle_ended(const char* from, const MsgEnded& m) {
    log("%s/%u ended at %s: %s", m.source_path.c_str(), static_cast<unsigned>(m.source_slot), from,
        to_string(m.reason));
    if (!ended_cb_) return;
    EndedEvent e;
    e.population = m.source_path.c_str();
    e.slot = m.source_slot;
    e.by_sku = from;
    e.reason = m.reason;
    e.has_instance = m.has_instance;
    e.instance = m.instance;
    ended_cb_(e, ended_ctx_);
}

} // namespace dataflou
