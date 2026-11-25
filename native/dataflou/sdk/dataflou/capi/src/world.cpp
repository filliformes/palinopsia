// world.cpp — the C interface (include/dataflou_c.h): the world as this node
// sees it (nodes, their params, as JSON), a node found by name, the peers and
// their endpoints, the universes seen, the topology's changes.

#include "node_internal.h"

#include "desktop/world_json.h"

#include <cstdlib>

using namespace df_internal;

namespace {

template <typename ParamNodeType>
void walk(const ParamNodeType* parent, const std::string& prefix, int depth,
          df_world_param* out, size_t capacity, size_t& count) {
    for (const ParamNodeType* child : parent->children) {
        const std::string path = prefix.empty() ? std::string(child->meta.name.c_str())
                                                : prefix + "/" + child->meta.name.c_str();
        if (count < capacity) {
            df_world_param& p = out[count];
            p = df_world_param{};
            copy(p.path, path.c_str());
            copy(p.label, child->meta.label.c_str());
            copy(p.unit, child->meta.unit.c_str());
            p.depth = depth;
            p.is_group = child->meta.kind != ParamKind::Param;
            p.slots = child->meta.slots;
            p.type = to_c(child->meta.type);
            p.flow = static_cast<df_flow>(child->meta.flow);
            to_c(child->value, &p.value);
            to_c(ParamValue(child->meta.range_min), &p.min);
            to_c(ParamValue(child->meta.range_max), &p.max);
            p.epoch = child->change_epoch;
            p.connections = static_cast<int>(child->subscriptions.size());
        }
        ++count;
        walk(child, path, depth + 1, out, capacity, count);
    }
}

} // namespace

extern "C" {

size_t df_world_node_count(const df_node* n) {
    return n ? n->node->world().nodes().size() : 0;
}

bool df_world_node_at(const df_node* n, size_t index, df_world_node* out) {
    if (!n || !out || index >= n->node->world().nodes().size()) return false;
    const NodeEntry& entry = n->node->world().nodes()[index];
    *out = df_world_node{};
    copy(out->sku, entry.identity.sku.c_str());
    copy(out->label, entry.identity.label.c_str());
    copy(out->product, entry.identity.product.c_str());
    out->online = entry.online;
    out->local = entry.is_local;
    return true;
}

size_t df_world_params(const df_node* n, const char* sku, df_world_param* out, size_t capacity) {
    if (!n || !sku) return 0;
    const NodeEntry* entry = n->node->world().find_node(sku);
    if (!entry) return 0;
    size_t count = 0;
    walk(entry->params.root(), std::string(), 0, out, out ? capacity : 0, count);
    return count;
}

bool df_find(const df_node* n, const char* name_or_sku, char out[37]) {
    if (!n || !name_or_sku || !out) return false;
    const auto sku = n->node->find_sku(name_or_sku);
    if (sku.empty()) return false;
    std::snprintf(out, 37, "%s", sku.c_str());
    return true;
}

void df_node_on_peer(df_node* n, df_peer_fn fn, void* context) {
    if (!n) return;
    n->on_peer = fn;
    n->peer_context = context;
}

char* df_world_json(const df_node* n) {
    if (!n) return nullptr;
    n->node->sync_local_to_world();   // this node's own values, current
    char* s = world_to_json(*n->node);
    if (!s) return nullptr;
    char* out = static_cast<char*>(std::malloc(std::strlen(s) + 1));
    if (out) std::strcpy(out, s);
    json_free(s);
    return out;
}

// --- What a patching host needs (Max's [data.node]) ---

void df_node_on_topology(df_node* n, df_topology_fn fn, void* context) {
    if (!n) return;
    n->on_topology = fn;
    n->topology_context = context;
    n->node->on_topology_changed(fn ? [](void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_topology) self->on_topology(self->topology_context);
    } : nullptr, n);
}

bool df_peer_endpoint(const df_node* n, const char* sku, char address[64], uint16_t* port) {
    if (!n || !sku) return false;
    const char* addr = nullptr;
    uint16_t p = 0;
    if (!n->node->peer_endpoint(sku, &addr, &p)) return false;
    if (address) {
        std::strncpy(address, addr ? addr : "", 63);
        address[63] = '\0';
    }
    if (port) *port = p;
    return true;
}

size_t df_universe_count(const df_node* n) {
    return n ? n->node->universes_seen().size() : 0;
}

bool df_universe_at(const df_node* n, size_t index, char out[33]) {
    if (!n || !out || index >= n->node->universes_seen().size()) return false;
    std::strncpy(out, n->node->universes_seen()[index].c_str(), 32);
    out[32] = '\0';
    return true;
}

} // extern "C"
