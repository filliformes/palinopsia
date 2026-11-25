// state.cpp — the C interface (include/dataflou_c.h): a node's state
// exported and imported.

#include "node_internal.h"

#include "desktop/state_json.h"
#include "desktop/world_json.h"   // json_free()

#include <cstdlib>

using namespace df_internal;

namespace df_internal {

// An imported state's values, to the params that are there (one, if given)
void give_imported(df_node& n, const char* path) {
    if (n.imported_values.empty()) return;
    ExportedState s;
    for (auto it = n.imported_values.begin(); it != n.imported_values.end();) {
        if ((path && it->first != path) || !n.node->local_params().resolve(it->first.c_str())) {
            ++it;
            continue;
        }
        s.values.push_back(*it);
        it = n.imported_values.erase(it);
    }
    state_apply_values(*n.node, s);
}

} // namespace df_internal

extern "C" {

char* df_export_state(df_node* n) {
    if (!n) return nullptr;
    if (!n->loaded && !load(*n)) return nullptr;
    char* s = state_to_json(*n->node, n->storage);
    if (!s) return nullptr;
    char* out = static_cast<char*>(std::malloc(std::strlen(s) + 1));
    if (out) std::strcpy(out, s);
    json_free(s);
    return out;
}

bool df_state_sku(const char* state, char sku[37]) {
    ExportedState s;
    std::string error;
    if (!sku || !state_from_json(state, s, error)) return false;
    std::memcpy(sku, s.identity.sku.c_str(), 37);
    return true;
}

bool df_import_state(df_node* n, const char* state) {
    if (!n || n->started) return false;
    ExportedState s;
    std::string error;
    if (!state_from_json(state, s, error)) {
        if (n->log) n->log(("import: " + error).c_str(), n->log_context);
        return false;
    }
    if (s.identity.sku != n->sku.c_str()) {
        if (n->log) n->log(("import: a state of " + std::string(s.identity.sku.c_str()) +
                            ", not of this node: create the node under that sku (df_state_sku)").c_str(),
                           n->log_context);
        return false;
    }
    if (!state_write_records(s, n->storage)) return false;
    n->imported_values = std::move(s.values);
    return true;
}

} // extern "C"
