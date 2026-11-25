#pragma once

#include "dataflou/types.h"
#include "dataflou/param.h"
#include "dataflou/scene.h"
#include "dataflou/connection.h"
#include "dataflou/memory.h"
#include <etl/string.h>

namespace dataflou {

// Compile-time selection: slim+pool on embedded, full on desktop
#ifdef DATAFLOU_SLIM_WORLDVIEW
using WorldParamStore = ParamStoreSlim;
using WorldParamNode  = ParamNodeSlim;
#else
using WorldParamStore = ParamStore;
using WorldParamNode  = ParamNode;
#endif

struct NodeEntry {
    NodeIdentity identity;
    uint32_t     decl_version  = 0;
    bool         is_local      = false;
    bool         online        = false;
    uint64_t     last_seen_ms  = 0;
    uint64_t     first_seen_ms = 0;
    uint64_t     offline_since_ms = 0; // when it went offline (0: online, or never seen go)
    SceneStatus  scene;          // from its declaration
    NodeRole     role = NodeRole::Full; // from its HELLO (direct peers only)
    uint32_t     max_frame = 0;  // from its HELLO: largest frame it takes (0: not said)
    MemoryState  mem;            // from its HELLO and DIGEST (direct peers only)
    WorldParamStore params;
    // Its connections, as it last said them (CONNS, 9.1), and their version
    ConnectionList connections;
    uint32_t       conn_version = 0;
};

class WorldView {
public:
    // All known nodes (online + offline). An entry keeps its address until
    // the node is removed.
    const StableVector<NodeEntry>& nodes() const { return nodes_; }

    // Lookup by SKU.
    NodeEntry*       find_node(const char* sku);
    const NodeEntry* find_node(const char* sku) const;

    // Add or update a node entry. Returns pointer to the entry; nullptr if
    // a new one doesn't fit.
    NodeEntry* upsert_node(const char* sku);

    // Remove a node (FLUSH).
    bool remove_node(const char* sku);

    // Mark a node offline (its destinations ground themselves: see Node).
    void mark_offline(const char* sku);

    // Mark a node online.
    void mark_online(const char* sku, uint64_t now_ms);

    // Version vector: map of sku -> decl_version for all known nodes.
    using VersionVector = Map<etl::string<36>, uint32_t>;
    VersionVector version_vector() const;
    // The same for connection lists (nodes that said one)
    VersionVector conn_versions() const;

private:
    StableVector<NodeEntry> nodes_;
};

} // namespace dataflou
