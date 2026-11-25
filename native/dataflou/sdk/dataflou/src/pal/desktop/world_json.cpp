#include "desktop/world_json.h"
#include "dataflou/array.h"
#include <cJSON.h>
#include <string>
#include <vector>
#include <cstring>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#endif

namespace dataflou {

static cJSON* value_to_json(const ParamValue& val);

cJSON* param_value_to_json(const ParamValue& v) { return value_to_json(v); }

static cJSON* value_to_json(const ParamValue& val) {
    using enum ParamType;
    if (val.unknown) return cJSON_CreateNull();        // no value known (9.1)
    switch (val.tag) {
    case Bool:
        return cJSON_CreateBool(val.b);
    case Number:
        return cJSON_CreateNumber(val.n);
    case String:
        return cJSON_CreateString(val.s.c_str());
    case V2: {
        cJSON* arr = cJSON_CreateArray();
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v2[0]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v2[1]));
        return arr;
    }
    case V3: {
        cJSON* arr = cJSON_CreateArray();
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v3[0]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v3[1]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v3[2]));
        return arr;
    }
    case V4: {
        cJSON* arr = cJSON_CreateArray();
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v4[0]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v4[1]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v4[2]));
        cJSON_AddItemToArray(arr, cJSON_CreateNumber(val.v4[3]));
        return arr;
    }
    case Blob:
        return cJSON_CreateString(val.s.c_str());
    case Colour: {
        char hex[10];
        snprintf(hex, sizeof(hex), "#%02X%02X%02X%02X",
                 val.rgba[0], val.rgba[1], val.rgba[2], val.rgba[3]);
        return cJSON_CreateString(hex);
    }
    case Trigger:
        return cJSON_CreateNumber(val.n);   // how many times it fired here
    case Array: {                           // 9.3: its elements, each as its own type says it
        cJSON* arr = cJSON_CreateArray();
        ParamValue x;
        for (size_t i = 0; i < array_count(val); ++i)
            if (array_get(val, i, x)) cJSON_AddItemToArray(arr, value_to_json(x));
        return arr;
    }
    }
    return cJSON_CreateNull();
}

// "<origin>-<counter>": who made a connection, and when (its Lamport count)
static const char* connection_id_text(const ConnectionId& id, char* out, size_t n) {
    snprintf(out, n, "%08x-%u", static_cast<unsigned>(id.origin), static_cast<unsigned>(id.counter));
    return out;
}

// "connections" (9.1): a node's connections as it keeps them, each with its
// links; a link with a transform has "axes", one per component.
static cJSON* connections_to_json(const ConnectionList& list) {
    cJSON* arr = cJSON_CreateArray();
    for (const auto& c : list) {
        cJSON* o = cJSON_CreateObject();
        char id[24];
        cJSON_AddStringToObject(o, "id", connection_id_text(c.id, id, sizeof(id)));
        cJSON_AddStringToObject(o, "dest", c.dest.c_str());
        cJSON_AddStringToObject(o, "sku", c.source_sku.c_str());
        cJSON_AddStringToObject(o, "source", c.source.c_str());
        if (c.poly) cJSON_AddBoolToObject(o, "poly", 1);
        if (c.pick.any()) {                            // one instance of the source's "*" level
            cJSON* pk = cJSON_AddObjectToObject(o, "pick");
            cJSON_AddNumberToObject(pk, c.pick.kind == Pick::Id ? "id" : "rank", c.pick.value);
        }
        cJSON* links = cJSON_AddArrayToObject(o, "links");
        for (const auto& l : c.links) {
            cJSON* lo = cJSON_CreateObject();
            cJSON_AddStringToObject(lo, "dest", l.dest.c_str());
            cJSON_AddStringToObject(lo, "source", l.source.c_str());
            if (l.chosen) cJSON_AddBoolToObject(lo, "chosen", 1);
            if (!l.plain()) {
                cJSON* axes = cJSON_AddArrayToObject(lo, "axes");
                for (const auto& a : l.axes) {
                    cJSON* ao = cJSON_CreateObject();
                    if (a.in_set) {
                        cJSON* r = cJSON_AddArrayToObject(ao, "in");
                        cJSON_AddItemToArray(r, cJSON_CreateNumber(a.in_min));
                        cJSON_AddItemToArray(r, cJSON_CreateNumber(a.in_max));
                    }
                    if (a.out_set) {
                        cJSON* r = cJSON_AddArrayToObject(ao, "out");
                        cJSON_AddItemToArray(r, cJSON_CreateNumber(a.out_min));
                        cJSON_AddItemToArray(r, cJSON_CreateNumber(a.out_max));
                    }
                    if (!a.curve.straight()) {
                        cJSON* k = cJSON_AddArrayToObject(ao, "curve");
                        for (uint8_t i = 0; i < a.curve.n; ++i) {
                            cJSON* pt = cJSON_CreateArray();
                            cJSON_AddItemToArray(pt, cJSON_CreateNumber(a.curve.x[i]));
                            cJSON_AddItemToArray(pt, cJSON_CreateNumber(a.curve.y[i]));
                            cJSON_AddItemToArray(k, pt);
                        }
                        if (a.curve.free) cJSON_AddBoolToObject(ao, "free", 1);
                    }
                    cJSON_AddItemToArray(axes, ao);
                }
            }
            cJSON_AddItemToArray(links, lo);
        }
        cJSON_AddItemToArray(arr, o);
    }
    return arr;
}

static cJSON* param_node_to_json(const ParamNode* node) {
    cJSON* obj = cJSON_CreateObject();

    const char* name = node->meta.name.empty() ? "root" : node->meta.name.c_str();
    cJSON_AddStringToObject(obj, "name", name);
    if (node->error) {
        cJSON_AddBoolToObject(obj, "error", 1);
    }

    if (node->meta.kind == ParamKind::Group || node->meta.kind == ParamKind::Class) {
        cJSON_AddStringToObject(obj, "kind", "group");
        if (!node->meta.label.empty()) {
            cJSON_AddStringToObject(obj, "label", node->meta.label.c_str());
        }
        // A poly group: its children are its slots
        if (node->meta.slots > 0) {
            cJSON_AddNumberToObject(obj, "slots", node->meta.slots);
            if (node->meta.full != FullPolicy::Steal)
                cJSON_AddStringToObject(obj, "full", to_string(node->meta.full));
            if (node->meta.ids != IdsMode::Auto)
                cJSON_AddStringToObject(obj, "ids", to_string(node->meta.ids));
            if (node->meta.grace_ms > 0) cJSON_AddNumberToObject(obj, "grace", node->meta.grace_ms);
            if (node->meta.hold >= 0.0f) cJSON_AddNumberToObject(obj, "hold", node->meta.hold);
        }

        if (!node->children.empty()) {
            cJSON* children = cJSON_CreateArray();
            for (const auto* child : node->children) {
                cJSON_AddItemToArray(children, param_node_to_json(child));
            }
            cJSON_AddItemToObject(obj, "children", children);
        }
    } else {
        cJSON_AddStringToObject(obj, "kind", "param");
        if (!node->meta.label.empty()) {
            cJSON_AddStringToObject(obj, "label", node->meta.label.c_str());
        }
        cJSON_AddStringToObject(obj, "type", to_string(node->meta.type));
        if (node->meta.type == ParamType::Array) {       // 9.3: N values of one type
            cJSON_AddStringToObject(obj, "of", to_string(node->meta.of));
            cJSON_AddNumberToObject(obj, "size", node->meta.size);
        }
        cJSON_AddStringToObject(obj, "flow", to_string(node->meta.flow));
        cJSON_AddNumberToObject(obj, "rate", static_cast<double>(node->meta.rate));
        cJSON_AddItemToObject(obj, "value", value_to_json(node->value));
        // The mesh time its value is true at, when its source stamped it (9.3)
        if (node->stamp) cJSON_AddNumberToObject(obj, "stamp", static_cast<double>(node->stamp));

        // Mode
        cJSON_AddStringToObject(obj, "mode", to_string(node->meta.mode));

        // Access
        cJSON_AddStringToObject(obj, "access", to_string(node->meta.access));

        cJSON_AddStringToObject(obj, "topology", to_string(node->meta.topology));
        if (node->meta.nature != Nature::Lin)
            cJSON_AddStringToObject(obj, "nature", to_string(node->meta.nature));

        if (node->meta.grounds()) {
            cJSON* g = cJSON_AddArrayToObject(obj, "ground");   // seconds, [up, down]
            cJSON_AddItemToArray(g, cJSON_CreateNumber(node->meta.ground_up));
            cJSON_AddItemToArray(g, cJSON_CreateNumber(node->meta.ground_down));
        }
        // A destination's state and the origin of its last end (9.0)
        if (node->dest != DestState::Free || node->end_origin != EndOrigin::None) {
            cJSON_AddStringToObject(obj, "dest", to_string(node->dest));
            if (node->end_origin != EndOrigin::None)
                cJSON_AddStringToObject(obj, "end", to_string(node->end_origin));
        }

        cJSON_AddBoolToObject(obj, "hardware", node->meta.hardware ? 1 : 0);
        if (node->meta.role != ParamRole::None)
            cJSON_AddStringToObject(obj, "role", to_string(node->meta.role));
        if (node->meta.every) cJSON_AddStringToObject(obj, "samples", "every");
        if (merge_of(node->meta) != MergeMode::Ltp)        // 9.3: how it combines its links
            cJSON_AddStringToObject(obj, "merge", to_string(merge_of(node->meta)));

        if (!node->meta.unit.empty()) {
            cJSON_AddStringToObject(obj, "unit", node->meta.unit.c_str());
        }

        // Range (an array's: one element's, for all of them)
        using enum ParamType;
        if (node->meta.type == Number ||
            (node->meta.type == Array && elem_scalar(node->meta.of) == Number)) {
            cJSON* range = cJSON_CreateObject();
            cJSON_AddNumberToObject(range, "min", node->meta.range_min.n);
            cJSON_AddNumberToObject(range, "max", node->meta.range_max.n);
            cJSON_AddItemToObject(obj, "range", range);
        } else if (node->meta.type == V2 ||
                   node->meta.type == V3 ||
                   node->meta.type == V4) {
            cJSON* range = cJSON_CreateObject();
            cJSON_AddItemToObject(range, "min", value_to_json(node->meta.range_min));
            cJSON_AddItemToObject(range, "max", value_to_json(node->meta.range_max));
            cJSON_AddItemToObject(obj, "range", range);
        }

        // Subscriptions
        if (!node->subscriptions.empty()) {
            cJSON* subs = cJSON_CreateArray();
            for (const auto& sub : node->subscriptions) {
                cJSON* s = cJSON_CreateObject();
                cJSON_AddStringToObject(s, "sku", sub.source_sku.c_str());
                cJSON_AddStringToObject(s, "path", sub.source_path.c_str());
                if (!sub.id.empty()) {
                    char id[24];
                    cJSON_AddStringToObject(s, "id", connection_id_text(sub.id, id, sizeof(id)));
                }
                cJSON_AddItemToArray(subs, s);
            }
            cJSON_AddItemToObject(obj, "subs", subs);
        }
    }

    return obj;
}

// "scene": the node's own scene status (see scene.h); slots it holds, 1-based.
static cJSON* scene_status_to_json(const SceneStatus& st) {
    cJSON* obj = cJSON_CreateObject();
    cJSON_AddNumberToObject(obj, "current", st.current);
    cJSON_AddStringToObject(obj, "state", to_string(st.state));
    cJSON* slots = cJSON_CreateArray();
    for (int n = 1; n <= 32; ++n) {
        if (st.slots & (1u << (n - 1))) cJSON_AddItemToArray(slots, cJSON_CreateNumber(n));
    }
    cJSON_AddItemToObject(obj, "slots", slots);
    cJSON_AddNumberToObject(obj, "skipped", st.skipped);
    return obj;
}

static cJSON* world_to_cjson(const WorldView& world, const Node* local) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "snapshot");

    cJSON* nodes = cJSON_CreateArray();
    for (const auto& entry : world.nodes()) {
        cJSON* node = cJSON_CreateObject();
        cJSON_AddStringToObject(node, "sku", entry.identity.sku.c_str());
        cJSON_AddStringToObject(node, "label", entry.identity.label.c_str());
        cJSON_AddStringToObject(node, "product", entry.identity.product.c_str());
        cJSON_AddNumberToObject(node, "version", entry.identity.version);
        cJSON_AddStringToObject(node, "state", to_string(entry.identity.state));
        cJSON_AddBoolToObject(node, "online", entry.online);
        cJSON_AddBoolToObject(node, "is_local", entry.is_local);
        if (entry.role != NodeRole::Full) cJSON_AddStringToObject(node, "role", to_string(entry.role));
        if (entry.max_frame) cJSON_AddNumberToObject(node, "max_frame", entry.max_frame);
        // Memory: [used, room] in bytes, room null without a limit (ours, live)
        const MemoryState mem = entry.is_local ? Node::memory_state() : entry.mem;
        if (mem.said()) {
            cJSON* m = cJSON_CreateArray();
            cJSON_AddItemToArray(m, cJSON_CreateNumber(mem.used));
            cJSON_AddItemToArray(m, mem.room == UINT32_MAX ? cJSON_CreateNull()
                                                           : cJSON_CreateNumber(mem.room));
            cJSON_AddItemToObject(node, "mem", m);
        }
        cJSON_AddItemToObject(node, "scene", scene_status_to_json(entry.scene));
        cJSON_AddItemToObject(node, "params", param_node_to_json(entry.params.root()));
        if (!entry.connections.empty())
            cJSON_AddItemToObject(node, "connections", connections_to_json(entry.connections));
        cJSON_AddItemToArray(nodes, node);
    }
    cJSON_AddItemToObject(root, "nodes", nodes);
    return root;
}

// Host IPv4 addresses, LAN first: skips loopback, link-local and the usual
// virtual bridges (docker, libvirt, veth).
static std::vector<std::string> host_ipv4s() {
    std::vector<std::string> out;
#ifdef _WIN32
    char name[256] = {};
    if (gethostname(name, sizeof(name)) != 0) return out;
    addrinfo hints{}; hints.ai_family = AF_INET;
    addrinfo* res = nullptr;
    if (getaddrinfo(name, nullptr, &hints, &res) != 0) return out;
    for (addrinfo* a = res; a; a = a->ai_next) {
        char buf[INET_ADDRSTRLEN] = {};
        auto* sin = reinterpret_cast<sockaddr_in*>(a->ai_addr);
        if (!inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf))) continue;
        if (strncmp(buf, "127.", 4) == 0 || strncmp(buf, "169.254.", 8) == 0) continue;
        out.emplace_back(buf);
    }
    freeaddrinfo(res);
#else
    ifaddrs* ifs = nullptr;
    if (getifaddrs(&ifs) != 0) return out;
    for (ifaddrs* i = ifs; i; i = i->ifa_next) {
        if (!i->ifa_addr || i->ifa_addr->sa_family != AF_INET) continue;
        if (!(i->ifa_flags & IFF_UP) || (i->ifa_flags & IFF_LOOPBACK)) continue;
        const char* n = i->ifa_name ? i->ifa_name : "";
        if (!strncmp(n, "docker", 6) || !strncmp(n, "veth", 4) ||
            !strncmp(n, "br-", 3) || !strncmp(n, "virbr", 5)) continue;
        char buf[INET_ADDRSTRLEN] = {};
        auto* sin = reinterpret_cast<sockaddr_in*>(i->ifa_addr);
        if (!inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf))) continue;
        if (strncmp(buf, "169.254.", 8) == 0) continue;
        bool dup = false;
        for (auto& s : out) if (s == buf) dup = true;
        if (!dup) out.emplace_back(buf);
    }
    freeifaddrs(ifs);
#endif
    return out;
}

static bool is_loopback(const char* a) {
    return !strncmp(a, "127.", 4) || !strcmp(a, "::1") || !strncmp(a, "::ffff:127.", 11);
}

char* world_to_json(const WorldView& world) {
    cJSON* root = world_to_cjson(world, nullptr);
    char* str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return str;
}

char* world_to_json(const Node& node) {
    cJSON* root = world_to_cjson(node.world(), &node);
    // The mesh time now (9.3): against it, a value's stamp says how long ago
    // it was true (or that it is due later)
    cJSON_AddNumberToObject(root, "mesh_ms", static_cast<double>(node.mesh_millis()));
    auto ips = host_ipv4s();
    cJSON* arr = cJSON_CreateArray();
    for (auto& ip : ips) cJSON_AddItemToArray(arr, cJSON_CreateString(ip.c_str()));
    cJSON_AddItemToObject(root, "host_ips", arr);
    const char* host_ip = ips.empty() ? "" : ips.front().c_str();

    // Nodes on another protocol: seen, not talked to
    cJSON* inc = cJSON_CreateArray();
    for (const auto& x : node.incompatible_nodes()) {
        cJSON* o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "sku", x.sku.c_str());
        cJSON_AddStringToObject(o, "label", x.label.c_str());
        if (x.core_major) cJSON_AddNumberToObject(o, "core_major", x.core_major);
        if (x.proto) cJSON_AddNumberToObject(o, "proto", x.proto);
        if (!x.core_ver.empty()) cJSON_AddStringToObject(o, "core_ver", x.core_ver.c_str());
        if (!x.address.empty()) cJSON_AddStringToObject(o, "address", x.address.c_str());
        if (x.port) cJSON_AddNumberToObject(o, "port", x.port);
        if (!x.product.empty()) cJSON_AddStringToObject(o, "product", x.product.c_str());
        cJSON_AddNumberToObject(o, "seen_s", static_cast<double>((node.millis_now() - x.last_ms) / 1000));
        cJSON_AddItemToArray(inc, o);
    }
    cJSON_AddItemToObject(root, "incompatible", inc);

    cJSON* nodes = cJSON_GetObjectItem(root, "nodes");
    cJSON* n = nullptr;
    cJSON_ArrayForEach(n, nodes) {
        cJSON* sku = cJSON_GetObjectItem(n, "sku");
        cJSON* loc = cJSON_GetObjectItem(n, "is_local");
        if (!cJSON_IsString(sku)) continue;
        // How its streams arrive here: [received, lost, late] packets
        if (!cJSON_IsTrue(loc)) {
            const auto st = node.link_stats(sku->valuestring);
            if (st.received || st.lost || st.late) {
                cJSON* l = cJSON_CreateArray();
                cJSON_AddItemToArray(l, cJSON_CreateNumber(st.received));
                cJSON_AddItemToArray(l, cJSON_CreateNumber(st.lost));
                cJSON_AddItemToArray(l, cJSON_CreateNumber(st.late));
                cJSON_AddItemToArray(l, st.latency_ms < 0 ? cJSON_CreateNull()
                                                          : cJSON_CreateNumber(st.latency_ms));
                cJSON_AddItemToObject(n, "link", l);
            }
        }
        const char* addr = nullptr;
        uint16_t port = 0;
        if (cJSON_IsTrue(loc)) {
            addr = host_ip;
            port = node.listen_port();
        } else if (!node.peer_endpoint(sku->valuestring, &addr, &port)) {
            continue;
        }
        // A peer on this machine reaches us over loopback: show the LAN address.
        if (addr && is_loopback(addr) && *host_ip) addr = host_ip;
        if (addr && *addr) cJSON_AddStringToObject(n, "address", addr);
        if (port) cJSON_AddNumberToObject(n, "port", port);
    }

    char* str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return str;
}

char* peer_joined_to_json(const char* sku, const char* label) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "peer_joined");
    cJSON_AddStringToObject(root, "sku", sku);
    cJSON_AddStringToObject(root, "label", label);
    char* str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return str;
}

char* peer_left_to_json(const char* sku) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "peer_left");
    cJSON_AddStringToObject(root, "sku", sku);
    char* str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return str;
}

void json_free(char* str) {
    cJSON_free(str);
}

bool connection_id_from_text(const char* s, ConnectionId& out) {
    if (!s) return false;
    unsigned origin = 0, counter = 0;
    if (std::sscanf(s, "%8x-%u", &origin, &counter) != 2 || counter == 0) return false;
    out.origin = origin;
    out.counter = counter;
    return true;
}

static bool pair_from_json(const cJSON* a, double& lo, double& hi) {
    if (!cJSON_IsArray(a) || cJSON_GetArraySize(a) != 2) return false;
    lo = cJSON_GetArrayItem(a, 0)->valuedouble;
    hi = cJSON_GetArrayItem(a, 1)->valuedouble;
    return true;
}

bool link_edit_from_json(const cJSON* root, ConnectionId& id, Link& link, uint8_t& what) {
    what = 0;
    if (!connection_id_from_text(cJSON_GetStringValue(cJSON_GetObjectItem(root, "id")), id)) return false;
    const char* dest = cJSON_GetStringValue(cJSON_GetObjectItem(root, "dest"));
    link.dest = dest ? dest : "";
    if (const char* src = cJSON_GetStringValue(cJSON_GetObjectItem(root, "source"))) {
        link.source = src;
        what |= LinkSource;
    }
    if (cJSON_IsTrue(cJSON_GetObjectItem(root, "reset"))) what |= LinkReset;
    const cJSON* axes = cJSON_GetObjectItem(root, "axes");
    if (cJSON_IsArray(axes)) {
        what |= LinkTransform;
        const cJSON* ax = nullptr;
        cJSON_ArrayForEach(ax, axes) {
            if (link.axes.size() >= 4) break;
            LinkAxis a;
            a.in_set = pair_from_json(cJSON_GetObjectItem(ax, "in"), a.in_min, a.in_max);
            a.out_set = pair_from_json(cJSON_GetObjectItem(ax, "out"), a.out_min, a.out_max);
            const cJSON* curve = cJSON_GetObjectItem(ax, "curve");
            const cJSON* pt = nullptr;
            if (cJSON_IsArray(curve))
                cJSON_ArrayForEach(pt, curve) {
                    double x = 0, y = 0;
                    if (a.curve.n >= CURVE_POINTS_MAX || !pair_from_json(pt, x, y)) continue;
                    a.curve.x[a.curve.n] = static_cast<float>(x);
                    a.curve.y[a.curve.n] = static_cast<float>(y);
                    ++a.curve.n;
                }
            a.curve.free = cJSON_IsTrue(cJSON_GetObjectItem(ax, "free"));
            link.axes.push_back(a);
        }
    }
    return what != 0;
}

} // namespace dataflou
