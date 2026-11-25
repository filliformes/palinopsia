#include "dataflou/world_view.h"
#include <cstring>

namespace dataflou {

NodeEntry* WorldView::find_node(const char* sku) {
    for (auto& entry : nodes_) {
        if (entry.identity.sku == sku) {
            return &entry;
        }
    }
    return nullptr;
}

const NodeEntry* WorldView::find_node(const char* sku) const {
    return const_cast<WorldView*>(this)->find_node(sku);
}

NodeEntry* WorldView::upsert_node(const char* sku) {
    NodeEntry* existing = find_node(sku);
    if (existing) return existing;

    NodeEntry* entry = nodes_.emplace_back();
    if (!entry) return nullptr;
    entry->identity.sku = sku;
    return entry;
}

bool WorldView::remove_node(const char* sku) {
    for (auto it = nodes_.begin(); it != nodes_.end(); ++it) {
        if (it->identity.sku == sku) {
            nodes_.erase(it);
            return true;
        }
    }
    return false;
}

void WorldView::mark_offline(const char* sku) {
    NodeEntry* entry = find_node(sku);
    if (!entry) return;
    entry->online = false;
}

void WorldView::mark_online(const char* sku, uint64_t now_ms) {
    NodeEntry* entry = find_node(sku);
    if (!entry) return;
    entry->online = true;
    entry->offline_since_ms = 0;
    entry->last_seen_ms = now_ms;
    if (entry->first_seen_ms == 0) {
        entry->first_seen_ms = now_ms;
    }
}

WorldView::VersionVector WorldView::version_vector() const {
    VersionVector vv;
    for (const auto& entry : nodes_) {
        vv.set(entry.identity.sku, entry.decl_version);
    }
    return vv;
}

WorldView::VersionVector WorldView::conn_versions() const {
    VersionVector vv;
    for (const auto& entry : nodes_)
        if (entry.conn_version) vv.set(entry.identity.sku, entry.conn_version);
    return vv;
}

} // namespace dataflou
