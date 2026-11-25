// node.cpp — the C interface (include/dataflou_c.h): a node's life (create,
// load, start, poll, stop), its identity, universe and log; the versions and
// features of the API.

#include "node_internal.h"

#include "dataflou/version.h"
#include "desktop/config_json.h"
#include "desktop/uuid5.h"

#include <cJSON.h>

#include <algorithm>
#include <cstdlib>

using namespace df_internal;

namespace {

// The params as the host gave them, under the identity and universe the node
// was created with: the core takes all three from one config.
std::string with_identity(const df_node& n) {
    cJSON* root = cJSON_Parse(n.config.c_str());
    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return {};
    }
    cJSON_DeleteItemFromObject(root, "identity");
    cJSON* identity = cJSON_AddObjectToObject(root, "identity");
    cJSON_AddStringToObject(identity, "sku", n.sku.c_str());
    cJSON_AddStringToObject(identity, "label", n.name.c_str());
    cJSON_AddStringToObject(identity, "product", n.product.c_str());
    cJSON_AddNumberToObject(identity, "version", 1);
    cJSON_AddStringToObject(identity, "state", "active");
    cJSON_DeleteItemFromObject(root, "universe");
    cJSON_AddStringToObject(root, "universe", n.universe.c_str());
    char* text = cJSON_PrintUnformatted(root);
    std::string json = text ? text : "";
    cJSON_free(text);
    cJSON_Delete(root);
    return json;
}

} // namespace

namespace df_internal {

bool load(df_node& n) {
    const std::string json = with_identity(n);
    if (json.empty()) return false;
    n.loaded = static_cast<bool>(n.node->load_json(json.c_str()));
    return n.loaded;
}

void give_value(df_node& n, const char* path, const ParamValue& value) {
    if (n.on_change) {
        df_value out;
        to_c(value, &out);
        n.on_change(path, &out, n.change_context);
    }
    if (n.on_array && value.tag == ParamType::Array && !value.unknown)
        n.on_array(path, static_cast<df_elem>(value.of), value.s.c_str(), array_count(value), n.array_context);
}

} // namespace df_internal

extern "C" {

void df_api_version(int* major, int* minor) {
    if (major) *major = DF_API_VERSION_MAJOR;
    if (minor) *minor = DF_API_VERSION_MINOR;
}

bool df_has_feature(const char* name) {
    static const char* const features[] = {
        "declare", "watch", "world_json", "monitor", "scenes", "phase", "seeds",
        "forget", "link_stats", "clock", "trigger", "text", "groups", "destinations",
        "populations", "samples", "unknown", "locate", "halt", "ids", "pick", "listen", "write_only", "state", "patching", "remove",
        "sources", "listeners", "shaping", "merge", "arrays", "timed", "read_only",
    };
    if (!name) return false;
    for (const char* f : features)
        if (std::strcmp(f, name) == 0) return true;
    return false;
}

const char* df_core_version(void) { return DATAFLOU_VERSION; }

void df_sku_from_seed(const char* seed, char out[37]) {
    const std::string uuid = dataflou_uuid5::from_name(seed ? seed : "");
    std::snprintf(out, 37, "%s", uuid.c_str());
}

df_node* df_node_create(const df_config* config) {
    // A size of 0: a caller from before the field (API < 0.1), same layout otherwise not
    if (!config || config->size < sizeof(df_config)) return nullptr;
    if (!config->sku || !*config->sku || !config->storage_dir) return nullptr;
    auto* n = new df_node(config->storage_dir);
    n->name = (config->name && *config->name) ? config->name : "node";
    n->sku = config->sku;
    n->product = config->product ? config->product : "";
    n->universe = (config->universe && *config->universe) ? config->universe : "default";
#if defined(__APPLE__)
    n->mdns.set_interface(config->interface);
#endif
    n->node = std::make_unique<Node>(n->tcp, n->mdns, n->clock, n->storage, n->udp);
    n->node->on_log([](const char* line, void* context) {
        auto* self = static_cast<df_node*>(context);
        if (self->log) self->log(line, self->log_context);
    }, n);
    return n;
}

void df_node_destroy(df_node* n) {
    if (!n) return;
    df_node_stop(n);
    delete n;
}

bool df_node_load_json(df_node* n, const char* json) {
    if (!n || !json || n->started) return false;
    n->config = json;
    return load(*n);
}

bool df_node_start(df_node* n) {
    if (!n || n->started) return false;
    if (!n->loaded && !load(*n)) return false;
    for (const auto& s : n->seeds) {
        const size_t colon = s.rfind(':');
        if (colon != std::string::npos)
            n->node->add_seed(s.substr(0, colon).c_str(),
                              static_cast<uint16_t>(std::atoi(s.c_str() + colon + 1)));
    }
    n->node->on_peer_joined([](const NodeIdentity& p, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_peer) self->on_peer(true, p.sku.c_str(), p.label.c_str(), self->peer_context);
    }, n);
    n->node->on_peer_left([](const NodeIdentity& p, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        if (self->on_peer) self->on_peer(false, p.sku.c_str(), p.label.c_str(), self->peer_context);
    }, n);
    n->node->start();
    n->started = n->node->listen_port() != 0;
    give_imported(*n, nullptr);
    return n->started;
}

void df_node_stop(df_node* n) {
    if (!n || !n->started) return;
    n->node->stop();
    n->started = false;
}

void df_node_poll(df_node* n) {
    if (!n || !n->started) return;
    n->node->poll();
    if (n->on_destination) {
        // What the core said changed, at once; the counts (sources going
        // online and offline) ten times a second
        std::vector<std::string> changed;
        changed.swap(n->destinations_changed);
        for (const auto& path : changed)
            if (const ParamNode* p = n->node->local_params().resolve(path.c_str()))
                report_destination(*n, path, *p);
        const uint64_t now = n->clock.millis();
        if (now - n->destinations_counted_ms >= 100) {
            n->destinations_counted_ms = now;
            report_destinations(*n, n->node->local_params().root(), std::string());
        }
    }
    if (!n->on_change && !n->on_array) { give_edges(*n); return; }
    // A param whose every sample counts: each of them, in order
    for (auto& [path, value] : std::exchange(n->samples, {})) {
        for (auto& w : n->watches) {
            if (w.path != path) continue;
            if (const ParamNode* p = n->node->local_params().resolve(w.path.c_str())) w.epoch = p->change_epoch;
            give_value(*n, w.path.c_str(), value);
        }
    }
    // The values, then the edges, then the gates (an edge says why before
    // its gate says it ended)
    for (const bool gates : { false, true }) {
        if (gates) give_edges(*n);
        for (auto& w : n->watches) {
            const ParamNode* p = n->node->local_params().resolve(w.path.c_str());
            if (!p || p->change_epoch == w.epoch || n->node->is_gate(p) != gates) continue;
            // A trigger is events: each firing since the last poll, not the
            // last one only (each moves the counter by one)
            const uint32_t fired = p->meta.type == ParamType::Trigger ? p->change_epoch - w.epoch : 1;
            w.epoch = p->change_epoch;
            if (p->meta.type == ParamType::Array) {   // its elements too (on_array)
                give_value(*n, w.path.c_str(), p->value);
                continue;
            }
            if (!n->on_change) continue;
            df_value out;
            to_c(p->value, &out);
            const uint32_t times = std::min<uint32_t>(fired, 64);
            for (uint32_t k = 0; k < times; ++k) {
                if (out.type == DF_TRIGGER) out.n = p->value.n - static_cast<double>(times - 1 - k);
                n->on_change(w.path.c_str(), &out, n->change_context);
            }
        }
    }
}

const char* df_node_sku(const df_node* n) { return n ? n->sku.c_str() : ""; }

uint16_t df_node_port(const df_node* n) { return (n && n->started) ? n->node->listen_port() : 0; }

const char* df_node_discovery_status(const df_node* n) {
    return n ? discovery_status(n->mdns) : "";
}

void df_node_on_log(df_node* n, df_log_fn fn, void* context) {
    if (!n) return;
    n->log = fn;
    n->log_context = context;
}

void df_free(char* s) { std::free(s); }

// --- What a patching host needs (Max's [data.node]) ---

const char* df_node_universe(const df_node* n) {
    return n ? n->node->universe().c_str() : "";
}

bool df_set_universe(df_node* n, const char* universe, const char* storage_dir) {
    if (!n || !universe || !*universe) return false;
    // Storage first: the node persists in the new one right away
    if (storage_dir && *storage_dir) n->storage.set_directory(storage_dir);
    n->universe = universe;
    n->node->set_universe(universe);
    return true;
}

bool df_node_apply_json(df_node* n, const char* json, char* error, size_t capacity) {
    if (!n || !json) return false;
    std::string why;
    const bool ok = n->started ? apply_config(*n->node, json, why) : df_node_load_json(n, json);
    if (!ok && why.empty()) why = "the config was refused";
    if (!ok && error && capacity) {
        std::strncpy(error, why.c_str(), capacity - 1);
        error[capacity - 1] = '\0';
    }
    return ok;
}

} // extern "C"
