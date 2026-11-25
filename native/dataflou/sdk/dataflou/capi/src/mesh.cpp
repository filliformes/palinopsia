// mesh.cpp — the C interface (include/dataflou_c.h): what is done to the
// mesh as a whole or asked of it: scenes, the phase, locate, halt, seeds,
// forgetting nodes, link statistics, the mesh clock, monitoring, identify.

#include "node_internal.h"

using namespace df_internal;

static_assert(static_cast<int>(SceneState::Missing) == DF_SCENE_MISSING, "df_scene_state follows SceneState");
static_assert(static_cast<int>(SceneOp::Status) == DF_SCENE_STATUS, "df_scene_op follows SceneOp");

extern "C" {

void df_monitor(df_node* n, bool on) {
    if (n) n->node->set_monitoring(on);
}

bool df_scene_recall(df_node* n, int slot) {
    return n && slot >= 1 && slot <= 255 && n->node->scene_recall(static_cast<uint8_t>(slot));
}

bool df_scene_store(df_node* n, int slot) {
    return n && slot >= 1 && slot <= 255 && n->node->scene_store(static_cast<uint8_t>(slot));
}

bool df_presentation(const df_node* n) {
    return n && n->node->phase() == Phase::Presentation;
}

void df_set_presentation(df_node* n, bool presentation) {
    if (n) n->node->set_phase(presentation ? Phase::Presentation : Phase::Preparation);
}

bool df_locate(df_node* n, const char* sku, const char* path, uint32_t ms) {
    return n && sku && path && n->node->locate(sku, path, ms).has_value();
}

void df_node_on_locate(df_node* n, df_locate_fn fn, void* context) {
    if (!n) return;
    n->on_locate = fn;
    n->locate_context = context;
    n->node->on_locate(fn ? [](const char* path, bool on, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_locate) self->on_locate(path, on, self->locate_context);
    } : nullptr, n);
}

bool df_locating(const df_node* n, const char* path) {
    return n && path && n->node->locating(path);
}

void df_halt(df_node* n, bool on) {
    if (n) n->node->halt(on);
}

bool df_halted(const df_node* n) {
    return n && n->node->halted();
}

void df_node_on_halt(df_node* n, df_halt_fn fn, void* context) {
    if (!n) return;
    n->on_halt = fn;
    n->halt_context = context;
    n->node->on_halt(fn ? [](bool on, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_halt) self->on_halt(on, self->halt_context);
    } : nullptr, n);
}

void df_add_seed(df_node* n, const char* host, uint16_t port) {
    if (!n || !host || !*host || !port) return;
    if (n->started) n->node->add_seed(host, port);
    else n->seeds.push_back(std::string(host) + ":" + std::to_string(port));
}

bool df_forget(df_node* n, const char* sku) {
    if (!n || !sku || !n->node->world().find_node(sku)) return false;
    n->node->flush_node(sku);
    return true;
}

size_t df_forget_offline(df_node* n, bool mesh) {
    return n ? n->node->forget_offline(mesh) : 0;
}

bool df_link_stats(const df_node* n, const char* sku, df_link* out) {
    if (!n || !sku || !out) return false;
    const auto s = n->node->link_stats(sku);
    out->received = s.received;
    out->lost = s.lost;
    out->late = s.late;
    out->latency_ms = s.latency_ms;
    return true;
}

double df_mesh_time(const df_node* n, bool* synced) {
    if (!n) return 0;
    if (synced) *synced = n->node->clock_synced();
    return static_cast<double>(n->node->mesh_millis());
}

// --- What a patching host needs (Max's [data.node]) ---

void df_identify(df_node* n) {
    if (n) n->node->identify();
}

void df_pin_phase(df_node* n, bool pinned, bool presentation) {
    if (n) n->node->pin_phase(pinned, presentation ? Phase::Presentation : Phase::Preparation);
}

static df_scene scene_of(const Node& node, const SceneStatus& st) {
    df_scene s{};
    s.cue = node.scene_cue().slot;
    s.current = st.current;
    s.state = static_cast<df_scene_state>(st.state);
    s.skipped = st.skipped;
    s.slots = st.slots;
    return s;
}

bool df_scene_get(const df_node* n, df_scene* out) {
    if (!n || !out) return false;
    *out = scene_of(*n->node, n->node->scene_status());
    return true;
}

void df_node_on_scene(df_node* n, df_scene_fn fn, void* context) {
    if (!n) return;
    n->on_scene = fn;
    n->scene_context = context;
    n->node->on_scene(fn ? [](SceneOp op, uint8_t slot, const SceneStatus& st, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (!self->on_scene) return;
        const df_scene s = scene_of(*self->node, st);
        self->on_scene(static_cast<df_scene_op>(op), slot, &s, self->scene_context);
    } : nullptr, n);
}

bool df_scene_links(df_node* n, int slot, df_scene_link_fn fn, void* context) {
    if (!n || !fn || slot < 1 || slot > 255) return false;
    struct Ctx { df_scene_link_fn fn; void* context; } c{ fn, context };
    return n->node->scene_links(static_cast<uint8_t>(slot), [](const char* path, const char* sku,
                                                               const char* source, void* ctx) {
        auto* c = static_cast<Ctx*>(ctx);
        c->fn(path, sku, source, c->context);
    }, &c);
}

} // extern "C"
