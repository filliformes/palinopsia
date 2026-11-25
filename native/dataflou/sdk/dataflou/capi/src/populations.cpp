// populations.cpp — the C interface (include/dataflou_c.h): populations,
// their instances (claimed, released, closed; started and stopped), the
// edges given at each poll, an instance by its id.

#include "node_internal.h"

#include <cstdlib>

using namespace df_internal;

// --- Populations ---

static_assert(static_cast<int>(EndReason::Split) == DF_REASON_SPLIT, "df_end_reason follows EndReason");
static_assert(static_cast<int>(Node::Edge::Relate) == DF_EDGE_RELATE, "df_edge follows Node::Edge");

extern "C" {

static df_instance instance_of(const Node::InstanceEvent& e, uint32_t size) {
    df_instance d{};
    d.size = size < sizeof(df_instance) ? size : static_cast<uint32_t>(sizeof(df_instance));
    d.population = e.population;
    d.slot = e.slot;
    d.edge = static_cast<df_edge>(e.edge);
    d.open = e.open;
    d.tentative = e.tentative;
    d.released = e.released;
    d.origin = static_cast<df_end_origin>(e.origin);
    d.reason = static_cast<df_end_reason>(e.reason);
    d.source_sku = e.source_sku ? e.source_sku : "";
    d.source_slot = e.source_slot;
    d.has_id = e.has_instance;
    d.id = e.instance;
    d.has_key = e.has_key;
    d.key = e.key;
    d.has_value = e.has_value;
    d.value = e.value;
    d.age_ms = e.age_ms;
    d.has_parent = e.has_parent;
    d.parent = e.parent;
    d.has_confidence = e.has_confidence;
    d.confidence = e.confidence;
    return d;
}

void df_node_on_instance(df_node* n, uint32_t size, df_instance_fn fn, void* context) {
    if (!n || (fn && size == 0)) return;
    n->instance_size = size;
    n->on_instance = fn;
    n->instance_context = context;
    n->node->on_instance(fn ? [](const Node::InstanceEvent& e, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        self->edges.push_back({ e, e.population ? e.population : "", e.source_sku ? e.source_sku : "" });
    } : nullptr, n);
}

bool df_instance_get(const df_node* n, const char* population, int slot, df_instance* out) {
    if (!n || !population || !out || out->size == 0 || slot < 1 || slot > 255) return false;
    Node::InstanceEvent e;
    if (!n->node->instance(population, static_cast<uint8_t>(slot), &e)) return false;
    const df_instance d = instance_of(e, out->size);
    std::memcpy(out, &d, d.size);
    return true;
}

int df_claim(df_node* n, const char* population) {
    if (!n || !population) return 0;
    return n->node->claim(population);
}

bool df_release(df_node* n, const char* population, int slot) {
    if (!n || !population || slot < 1 || slot > 255) return false;
    return n->node->release(population, static_cast<uint8_t>(slot));
}

bool df_close(df_node* n, const char* population, int slot) {
    if (!n || !population || slot < 1 || slot > 255) return false;
    return n->node->close_instance(population, static_cast<uint8_t>(slot));
}

int df_start_instance(df_node* n, const char* population, bool has_id, double id) {
    if (!n || !population) return 0;
    return n->node->start_instance(population, has_id ? &id : nullptr);
}

bool df_stop_instance(df_node* n, const char* population, int slot, df_end_reason reason) {
    if (!n || !population || slot < 1 || slot > 255) return false;
    return n->node->stop_instance(population, static_cast<uint8_t>(slot), static_cast<EndReason>(reason));
}

void df_node_on_ended(df_node* n, df_ended_fn fn, void* context) {
    if (!n) return;
    n->on_ended = fn;
    n->ended_context = context;
    n->node->on_ended(fn ? [](const Node::EndedEvent& e, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_ended)
            self->on_ended(e.population, e.slot, e.by_sku, static_cast<df_end_reason>(e.reason),
                           self->ended_context);
    } : nullptr, n);
}

// --- What a patching host needs (Max's [data.node]) ---

// A slot's id param (role Id, or named "id" with no role)
static const ParamNode* id_param(const ParamNode* slot) {
    for (const auto* c : slot->children)
        if (c->meta.kind == ParamKind::Param &&
            (c->meta.role == ParamRole::Id || (c->meta.role == ParamRole::None && c->meta.name == "id")))
            return c;
    return nullptr;
}

bool df_instance_id(const df_node* n, const char* population, int slot, double* id) {
    if (!n || !population || slot < 1 || slot > 255) return false;
    const std::string path = std::string(population) + "/" + std::to_string(slot);
    const ParamNode* s = n->node->local_params().resolve(path.c_str());
    const ParamNode* p = s ? id_param(s) : nullptr;
    if (!p) return false;
    if (id) *id = p->value.tag == ParamType::Bool ? p->value.b : p->value.n;
    return true;
}

int df_instance_slot(const df_node* n, const char* population, double id) {
    if (!n || !population) return 0;
    const ParamNode* pop = n->node->local_params().resolve(population);
    if (!pop || pop->meta.slots == 0) return 0;
    for (const auto* s : pop->children) {
        bool open = false;
        for (const auto* c : s->children) open = open || (n->node->is_gate(c) && c->value.b);
        double have = 0;
        if (open && df_instance_id(n, population, std::atoi(s->meta.name.c_str()), &have) && have == id)
            return std::atoi(s->meta.name.c_str());
    }
    return 0;
}

} // extern "C"

namespace df_internal {

void give_edges(df_node& n) {
    if (n.edges.empty()) return;
    n.given = std::exchange(n.edges, {});
    for (auto& x : n.given) {
        if (!n.on_instance) continue;
        x.e.population = x.population.c_str();
        x.e.source_sku = x.source_sku.c_str();
        const df_instance d = instance_of(x.e, n.instance_size);
        // Its size is the host's: a smaller struct gets its part
        alignas(df_instance) unsigned char host[sizeof(df_instance)] = {};
        std::memcpy(host, &d, d.size);
        n.on_instance(reinterpret_cast<const df_instance*>(host), n.instance_context);
    }
}

} // namespace df_internal
