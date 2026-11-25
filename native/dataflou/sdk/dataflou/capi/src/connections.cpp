// connections.cpp — the C interface (include/dataflou_c.h): connections
// made and undone (here, on another node, by pick), listening, the state
// of a destination; what one param shows of its connections (the sources
// it could listen to, its listeners) and a connection's shaping.

#include "node_internal.h"

#include <algorithm>
#include <cmath>

using namespace df_internal;

static_assert(static_cast<int>(DestState::Grounding) == DF_DEST_GROUNDING, "df_dest_state follows DestState");
static_assert(static_cast<int>(EndOrigin::Lost) == DF_END_LOST, "df_end_origin follows EndOrigin");

namespace {

df_destination destination_of(const df_node& n, const char* path, const ParamNode&) {
    const Node::Destination x = n.node->destination(path);
    df_destination d{};
    d.size = sizeof(df_destination);
    d.state = static_cast<df_dest_state>(x.state);
    d.origin = static_cast<df_end_origin>(x.origin);
    d.connections = x.connections;
    d.live = x.live;
    return d;
}

// For a host built with an older header (a smaller df_destination): the
// states and origins it knows, a later one given as the one it refines. API
// 0.1 is the first; a value added later gets its line here, with the size of
// the struct that brought it.
df_destination for_host(df_destination d, uint32_t size) {
    d.size = static_cast<uint32_t>(std::min<size_t>(size, sizeof d));
    return d;
}

bool same(const df_destination& a, const df_destination& b) {
    return a.state == b.state && a.origin == b.origin && a.connections == b.connections && a.live == b.live;
}

// --- The sources a destination could listen to (df_sources_for) ---

bool takes_from(FlowDir f) { return f == FlowDir::Source || f == FlowDir::Bidir; }

// A node's params that could feed a param of `type`, depth first; none in a
// population (its slots connect as a whole), `skip` aside (the destination)
template <typename ParamNodeType>
void candidates(const ParamNodeType* parent, const std::string& prefix, ParamType type, const char* skip,
                std::vector<std::pair<std::string, std::string>>& out) {
    for (const ParamNodeType* child : parent->children) {
        const std::string path = prefix.empty() ? std::string(child->meta.name.c_str())
                                                : prefix + "/" + child->meta.name.c_str();
        if (child->meta.kind != ParamKind::Param) {
            if (child->meta.slots == 0) candidates(child, path, type, skip, out);
            continue;
        }
        if (child->meta.type != type || !takes_from(child->meta.flow) || !readable(child->meta.access)) continue;
        if (skip && path == skip) continue;
        out.emplace_back(path, child->meta.label.c_str());
    }
}

// --- A connection's shaping (df_transform_*, df_shape_*) ---

uint8_t components(ParamType t) {
    switch (t) {
    case ParamType::Bool:
    case ParamType::Number: return 1;
    case ParamType::V2:     return 2;
    case ParamType::V3:     return 3;
    case ParamType::V4:
    case ParamType::Colour: return 4;
    default:                return 0;
    }
}

// A component of a destination's range, as the transform reads it (a bool
// and a colour are 0..1 by nature)
void range_of(const ParamMetaCore& m, uint8_t i, double& lo, double& hi) {
    switch (m.type) {
    case ParamType::Number: lo = m.range_min.n; hi = m.range_max.n; return;
    case ParamType::V2:     lo = m.range_min.v2[i]; hi = m.range_max.v2[i]; return;
    case ParamType::V3:     lo = m.range_min.v3[i]; hi = m.range_max.v3[i]; return;
    case ParamType::V4:     lo = m.range_min.v4[i]; hi = m.range_max.v4[i]; return;
    default:                lo = 0.0; hi = 1.0; return;
    }
}

// The link that feeds this node's `path` from that source, and the
// destination param (the connection: its id)
struct Feed {
    const ParamNode* dest = nullptr;
    const Link*      link = nullptr;
    ConnectionId     id;
};
Feed feed_of(const df_node& n, const char* path, const char* sku, const char* source_path) {
    Feed f;
    if (!path || !sku || !source_path) return f;
    f.dest = n.node->local_params().resolve(path);
    if (!f.dest || f.dest->meta.kind != ParamKind::Param || !components(f.dest->meta.type)) return f;
    const ConnectionList& list = n.node->connections();
    for (const auto& s : f.dest->subscriptions) {
        if (s.source_sku != sku || s.source_path != source_path) continue;
        if (s.conn >= list.size() || list[s.conn].id != s.id || s.link >= list[s.conn].links.size()) continue;
        f.link = &list[s.conn].links[s.link];
        f.id = s.id;
        return f;
    }
    return f;
}

// The presets' points: x², 1-(1-x)², smoothstep, through five points (the
// core's monotone cubic between them); inverted, a line down
struct Preset { df_curve curve; uint8_t n; float x[5], y[5]; };
constexpr Preset PRESETS[] = {
    { DF_CURVE_EASE_IN,  5, { 0, 0.25f, 0.5f, 0.75f, 1 }, { 0, 0.0625f, 0.25f, 0.5625f, 1 } },
    { DF_CURVE_EASE_OUT, 5, { 0, 0.25f, 0.5f, 0.75f, 1 }, { 0, 0.4375f, 0.75f, 0.9375f, 1 } },
    { DF_CURVE_S,        5, { 0, 0.25f, 0.5f, 0.75f, 1 }, { 0, 0.15625f, 0.5f, 0.84375f, 1 } },
    { DF_CURVE_INVERTED, 2, { 0, 1 }, { 1, 0 } },
};

Curve curve_of(df_curve c) {
    Curve out;
    for (const Preset& p : PRESETS) {
        if (p.curve != c) continue;
        out.n = p.n;
        for (uint8_t k = 0; k < p.n; ++k) { out.x[k] = p.x[k]; out.y[k] = p.y[k]; }
    }
    return out;   // linear: straight
}

df_curve preset_of(const Curve& c) {
    auto alike = [](float a, float b) { return std::fabs(a - b) < 1e-4f; };
    if (c.straight() || (c.n == 2 && !c.free && alike(c.x[0], 0) && alike(c.y[0], 0) && alike(c.x[1], 1) &&
                         alike(c.y[1], 1)))
        return DF_CURVE_LINEAR;
    for (const Preset& p : PRESETS) {
        bool same = !c.free && c.n == p.n;
        for (uint8_t k = 0; same && k < p.n; ++k) same = alike(c.x[k], p.x[k]) && alike(c.y[k], p.y[k]);
        if (same) return p.curve;
    }
    return DF_CURVE_CUSTOM;
}

df_range range_preset_of(const LinkAxis& a, const ParamMetaCore& dest, uint8_t i) {
    if (!a.in_set) return DF_RANGE_SOURCE;
    if (a.in_min == 0.0 && a.in_max == 1.0) return DF_RANGE_UNIT;
    double lo, hi;
    range_of(dest, i, lo, hi);
    return a.in_min == lo && a.in_max == hi ? DF_RANGE_DESTINATION : DF_RANGE_CUSTOM;
}

} // namespace

namespace df_internal {

// Reports a destination if it changed since last time (a free param never
// connected counts as reported)
void report_destination(df_node& n, const std::string& path, const ParamNode& p) {
    const df_destination d = destination_of(n, path.c_str(), p);
    auto it = std::find_if(n.destinations.begin(), n.destinations.end(),
                           [&](const auto& e) { return e.first == path; });
    if (it == n.destinations.end()) {
        if (d.state == DF_DEST_FREE && d.origin == DF_END_NONE && d.connections == 0) return;
        n.destinations.emplace_back(path, d);
    } else if (same(it->second, d)) {
        return;
    } else {
        it->second = d;
    }
    const df_destination host = for_host(d, n.destination_size);
    n.on_destination(path.c_str(), &host, n.destination_context);
}

void report_destinations(df_node& n, const ParamNode* parent, const std::string& prefix) {
    for (const ParamNode* child : parent->children) {
        const std::string path = prefix.empty() ? std::string(child->meta.name.c_str())
                                                : prefix + "/" + child->meta.name.c_str();
        if (child->meta.kind == ParamKind::Param) report_destination(n, path, *child);
        else if (child->meta.slots > 0) report_destination(n, path, *child);   // a population, whole
        else report_destinations(n, child, path);
    }
}

} // namespace df_internal

extern "C" {

bool df_connect(df_node* n, const char* local_path, const char* source_sku, const char* source_path) {
    return n && local_path && source_sku && source_path &&
           n->node->subscribe(local_path, source_sku, source_path);
}

bool df_disconnect(df_node* n, const char* local_path, const char* source_sku, const char* source_path) {
    return n && local_path && source_sku && source_path &&
           n->node->unsubscribe(local_path, source_sku, source_path);
}

bool df_connect_remote(df_node* n, const char* dest_sku, const char* dest_path,
                       const char* source_sku, const char* source_path) {
    return n && dest_sku && dest_path && source_sku && source_path &&
           static_cast<bool>(n->node->subscribe_remote(dest_sku, dest_path, source_sku, source_path));
}

bool df_listen(df_node* n, const char* path, const char* source, const char* source_path,
               df_pick by, double value) {
    if (!n || !path || !source || !source_path) return false;
    dataflou::Pick pick;
    if (by == DF_PICK_ID) pick.kind = dataflou::Pick::Id;
    else if (by == DF_PICK_RANK && value != 0) pick.kind = dataflou::Pick::Rank;
    else if (by != DF_PICK_NONE) return false;
    pick.value = by == DF_PICK_RANK ? static_cast<double>(static_cast<int>(value)) : value;
    n->node->listen(path, source, source_path, pick);
    return true;
}

bool df_stop_listening(df_node* n, const char* path, const char* source, const char* source_path) {
    return n && path && source && source_path && n->node->stop_listening(path, source, source_path);
}

bool df_connect_instance(df_node* n, const char* dest_sku, const char* dest_path,
                         const char* source_sku, const char* source_path, df_pick by, double value) {
    if (!n || !dest_sku || !dest_path || !source_sku || !source_path) return false;
    dataflou::Pick pick;
    if (by == DF_PICK_ID) pick.kind = dataflou::Pick::Id;
    else if (by == DF_PICK_RANK && value != 0) pick.kind = dataflou::Pick::Rank;
    else return false;
    pick.value = by == DF_PICK_RANK ? static_cast<double>(static_cast<int>(value)) : value;
    return static_cast<bool>(n->node->subscribe_remote(dest_sku, dest_path, source_sku, source_path, pick));
}

bool df_disconnect_remote(df_node* n, const char* dest_sku, const char* dest_path,
                          const char* source_sku, const char* source_path) {
    return n && dest_sku && dest_path && source_sku && source_path &&
           static_cast<bool>(n->node->unsubscribe_remote(dest_sku, dest_path, source_sku, source_path));
}

bool df_destination_get(const df_node* n, const char* path, df_destination* out) {
    if (!n || !path || !out || out->size == 0) return false;
    const ParamNode* p = n->node->local_params().resolve(path);
    if (!p || (p->meta.kind != ParamKind::Param && p->meta.slots == 0)) return false;
    const df_destination d = for_host(destination_of(*n, path, *p), out->size);
    std::memcpy(out, &d, d.size);   // an older, smaller struct: its part
    return true;
}

void df_node_on_destination(df_node* n, uint32_t size, df_destination_fn fn, void* context) {
    if (!n || (fn && size == 0)) return;
    n->destination_size = size;
    n->on_destination = fn;
    n->destination_context = context;
    n->node->on_destination([](const char* path, DestState, EndOrigin, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (std::find(self->destinations_changed.begin(), self->destinations_changed.end(), path)
            == self->destinations_changed.end())
            self->destinations_changed.emplace_back(path);
    }, n);
}

// --- What one param shows of its connections (API 0.5) ---

size_t df_sources_for(const df_node* n, const char* path, df_source_choice* out, size_t capacity) {
    if (!n || !path) return 0;
    const ParamNode* dest = n->node->local_params().resolve(path);
    if (!dest || dest->meta.kind != ParamKind::Param || dest->meta.flow == FlowDir::Source) return 0;
    const ParamType type = dest->meta.type;
    // The nodes in their order: this one, the others online, then offline,
    // each by its name
    std::vector<const NodeEntry*> nodes;
    for (const NodeEntry& e : n->node->world().nodes())
        if (!e.is_local) nodes.push_back(&e);
    std::sort(nodes.begin(), nodes.end(), [](const NodeEntry* a, const NodeEntry* b) {
        if (a->online != b->online) return a->online;
        const int c = std::strcmp(a->identity.label.c_str(), b->identity.label.c_str());
        return c != 0 ? c < 0 : a->identity.sku < b->identity.sku;
    });
    const NodeIdentity& self = n->node->identity();
    size_t count = 0;
    std::vector<std::pair<std::string, std::string>> params;
    auto add = [&](const char* sku, const char* label, bool online) {
        for (const auto& [p, l] : params) {
            if (out && count < capacity) {
                df_source_choice& c = out[count];
                c = df_source_choice{};
                copy(c.sku, sku);
                copy(c.node, label);
                c.online = online;
                copy(c.path, p.c_str());
                copy(c.label, l.c_str());
                for (const auto& s : dest->subscriptions)
                    c.connected = c.connected || (s.source_sku == sku && s.source_path == p.c_str());
            }
            ++count;
        }
        params.clear();
    };
    candidates(n->node->local_params().root(), std::string(), type, path, params);
    add(self.sku.c_str(), self.label.c_str(), true);
    for (const NodeEntry* e : nodes) {
        candidates(e->params.root(), std::string(), type, nullptr, params);
        add(e->identity.sku.c_str(), e->identity.label.c_str(), e->online);
    }
    return count;
}

size_t df_listeners(const df_node* n, const char* path, df_listener* out, size_t capacity) {
    if (!n || !path) return 0;
    struct Ctx { const df_node* n; df_listener* out; size_t capacity, count; } ctx { n, out, capacity, 0 };
    n->node->listeners(path, [](const char* sku, const char* dest_path, void* p) {
        auto* c = static_cast<Ctx*>(p);
        if (c->out && c->count < c->capacity) {
            df_listener& l = c->out[c->count];
            l = df_listener{};
            copy(l.sku, sku);
            const NodeEntry* e = c->n->node->world().find_node(sku);
            copy(l.node, e ? e->identity.label.c_str() : "");
            copy(l.path, dest_path);
        }
        ++c->count;
    }, &ctx);
    return ctx.count;
}

bool df_transform_get(const df_node* n, const char* path, const char* source_sku, const char* source_path,
                      df_transform* out) {
    if (!n || !out || out->size < sizeof(df_transform)) return false;
    const Feed f = feed_of(*n, path, source_sku, source_path);
    if (!f.link) return false;
    *out = df_transform{};
    out->size = sizeof(df_transform);
    out->axes = static_cast<int>(std::min<size_t>(f.link->axes.size(), 4));
    for (int i = 0; i < out->axes; ++i) {
        const LinkAxis& a = f.link->axes[static_cast<size_t>(i)];
        df_axis& d = out->axis[i];
        d.in_set = a.in_set;
        d.out_set = a.out_set;
        d.in_min = a.in_min;
        d.in_max = a.in_max;
        d.out_min = a.out_min;
        d.out_max = a.out_max;
        d.points = a.curve.n;
        for (uint8_t k = 0; k < a.curve.n && k < DF_CURVE_POINTS; ++k) {
            d.x[k] = a.curve.x[k];
            d.y[k] = a.curve.y[k];
        }
        d.free = a.curve.free;
    }
    return true;
}

bool df_transform_set(df_node* n, const char* path, const char* source_sku, const char* source_path,
                      const df_transform* t) {
    if (!n || !t || t->size < sizeof(df_transform) || t->axes < 0 || t->axes > 4) return false;
    const Feed f = feed_of(*n, path, source_sku, source_path);
    if (!f.link) return false;
    Link link;
    link.dest = f.link->dest;
    for (int i = 0; i < t->axes; ++i) {
        const df_axis& d = t->axis[i];
        if (d.points < 0 || d.points > DF_CURVE_POINTS) return false;
        LinkAxis a;
        a.in_set = d.in_set;
        a.out_set = d.out_set;
        a.in_min = d.in_min;
        a.in_max = d.in_max;
        a.out_min = d.out_min;
        a.out_max = d.out_max;
        a.curve.n = static_cast<uint8_t>(d.points);
        for (int k = 0; k < d.points; ++k) {
            a.curve.x[k] = d.x[k];
            a.curve.y[k] = d.y[k];
        }
        a.curve.free = d.free;
        if (!link.axes.push_back(a)) return false;
    }
    return n->node->edit_link(f.id, link, LinkTransform);
}

bool df_shape_get(const df_node* n, const char* path, const char* source_sku, const char* source_path,
                  df_shape* out) {
    if (!n || !out || out->size < sizeof(df_shape)) return false;
    const Feed f = feed_of(*n, path, source_sku, source_path);
    if (!f.link) return false;
    // Every component the same, or custom
    const uint8_t dc = components(f.dest->meta.type);
    const LinkAxis plain;
    df_curve curve = DF_CURVE_LINEAR;
    df_range range = DF_RANGE_SOURCE;
    for (uint8_t i = 0; i < dc; ++i) {
        const LinkAxis& a = i < f.link->axes.size() ? f.link->axes[i] : plain;
        const df_curve c = preset_of(a.curve);
        const df_range r = range_preset_of(a, f.dest->meta, i);
        curve = i == 0 || c == curve ? c : DF_CURVE_CUSTOM;
        range = i == 0 || r == range ? r : DF_RANGE_CUSTOM;
    }
    out->curve = curve;
    out->range = range;
    return true;
}

bool df_shape_set(df_node* n, const char* path, const char* source_sku, const char* source_path,
                  const df_shape* shape) {
    if (!n || !shape || shape->size < sizeof(df_shape)) return false;
    const Feed f = feed_of(*n, path, source_sku, source_path);
    if (!f.link) return false;
    const uint8_t dc = components(f.dest->meta.type);
    Link link;
    link.dest = f.link->dest;
    bool plain = true;
    for (uint8_t i = 0; i < dc; ++i) {
        LinkAxis a = i < f.link->axes.size() ? f.link->axes[i] : LinkAxis{};
        if (shape->curve != DF_CURVE_CUSTOM) a.curve = curve_of(shape->curve);
        switch (shape->range) {
        case DF_RANGE_SOURCE:      a.in_set = false; break;
        case DF_RANGE_DESTINATION: a.in_set = true; range_of(f.dest->meta, i, a.in_min, a.in_max); break;
        case DF_RANGE_UNIT:        a.in_set = true; a.in_min = 0.0; a.in_max = 1.0; break;
        default: break;
        }
        plain = plain && a.plain();
        if (!link.axes.push_back(a)) return false;
    }
    if (plain) link.axes.clear();   // nothing to say: the plain mapping
    return n->node->edit_link(f.id, link, LinkTransform);
}

} // extern "C"
