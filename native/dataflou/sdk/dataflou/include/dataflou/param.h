// param.h — ParamNodeT tree and ParamStoreT: the local parameter model.
//
// ParamStoreT<Meta> holds a tree of ParamNodeT<Meta> (groups and params), each
// node allocated on its own from the core's memory (memory.h): a tree grows as
// far as the budget goes, and a node keeps its address. Supports path-based
// lookup, subscription management, and dirty tracking for UDP streaming.
//
// ParamNode     = ParamNodeT<ParamMeta>      (full: label, description, unit…)
// ParamNodeSlim = ParamNodeT<ParamMetaCore>  (slim: what a remote node needs)
#pragma once

#include "dataflou/types.h"
#include "dataflou/memory.h"
#include <type_traits>

namespace dataflou {

// The longest path a node may declare, in bytes ("a/b/c", no leading slash):
// a stream packet names its param in a byte-counted string (stream_codec),
// and a saved connection record says each length in a byte. A segment has
// no limit of its own. A longer path is refused at declaration (nullptr),
// never cut.
constexpr size_t kMaxPathLength = 255;

template <typename Meta>
struct ParamNodeT {
    Meta       meta;
    ParamValue value;
    // The mesh time (ms) its value is true at, as its source stamped it
    // (9.3, docs/couches.md "Les valeurs datées"); 0: not stamped, true
    // when it was written or arrived
    uint64_t   stamp = 0;
    uint32_t   change_epoch = 0;
    bool       dirty        = false;
    bool       error        = false;
    // A destination's state and the origin of its last end (local params)
    DestState  dest       = DestState::Free;
    EndOrigin  end_origin = EndOrigin::None;
    uint64_t   wait_until = 0;      // Waiting: when the grace runs out
    Vector<ParamSubscription> subscriptions;

    ParamNodeT* parent = nullptr;
    Vector<ParamNodeT*> children;
};

using ParamNode     = ParamNodeT<ParamMeta>;
using ParamNodeSlim = ParamNodeT<ParamMetaCore>;

// Manages the parameter tree of one node.
template <typename Meta>
class ParamStoreT {
public:
    using NodeType = ParamNodeT<Meta>;
    using MetaType = Meta;

    ParamStoreT();
    ParamStoreT(const ParamStoreT& other);
    ParamStoreT& operator=(const ParamStoreT& other);

    // Build tree from parsed config. Returns false on error.
    bool load_from_json(const char* json_string);

    // Imperative declaration (alternative to JSON). nullptr if it doesn't fit.
    NodeType* declare_group(const char* path, const Meta& meta);
    NodeType* declare_param(const char* path, const Meta& meta);

    // Define a class template (only meaningful for ParamMeta).
    void define_class(const char* name, const Meta& meta);

    // Read access to class templates (e.g. to export the config).
    size_t      class_count() const { return classes_.size(); }
    const char* class_name(size_t i) const { return class_names_[i].c_str(); }
    const Meta& class_meta(size_t i) const { return classes_[i]; }
    const Meta* find_class(const char* name) const;

    // Lookup by path (e.g., "mixer/volume"). Returns nullptr if not found.
    NodeType* resolve(const char* path);
    const NodeType* resolve(const char* path) const;

    // Set/get value on a param node.
    bool set_value(const char* path, const ParamValue& val);
    const ParamValue* get_value(const char* path) const;

    // Tree root.
    NodeType* root() { return &root_; }
    const NodeType* root() const { return &root_; }

    // Collect and clear dirty flags. Returns number of dirty params.
    // Out of room in `out`, the rest stay dirty for the next call.
    size_t collect_dirty(Vector<NodeType*>& out);

    // Remove a param or group by path. Detaches it from its parent; the
    // nodes stay allocated until clear() (pointers to them stay valid).
    bool remove(const char* path);

    // Nodes held, attached or removed (groups and params, root aside).
    size_t node_count() const { return nodes_.size(); }

    // Clear all nodes, classes, and reset the root. Used to prepare for a fresh DECLARE decode.
    void clear();

    // Subscription management.
    bool subscribe(const char* local_path, const char* source_sku, const char* source_path,
                   ConnectionId id = {});
    bool unsubscribe(const char* local_path, const char* source_sku, const char* source_path);

private:
    NodeType root_;
    StableVector<NodeType> nodes_;            // every node but the root
    Vector<Meta> classes_;                    // class templates
    Vector<Text> class_names_;           // any length, as the names they match

    NodeType* find_or_create_group(const char* path, size_t n);   // its first n characters
    NodeType* allocate_node();
    // Attach a fresh node under parent; drops it if the parent can't hold it.
    NodeType* attach(NodeType* parent, NodeType* node);
    void clone_children(NodeType* dst, const NodeType* src);
    void apply_class_defaults(Meta& meta, const Meta& cls);
};

using ParamStore = ParamStoreT<ParamMeta>;

// A store to decode a peer's DECLARE into: the same, sized by what arrives.
using DecodeParamStore = ParamStore;

// ---------------------------------------------------------------------------
// ParamStoreSlim — the slim store for remote peers on embedded: each node
// allocated from the core's memory, all given back on clear().
// ---------------------------------------------------------------------------

class ParamStoreSlim {
public:
    using NodeType = ParamNodeSlim;
    using MetaType = ParamMetaCore;

    ParamStoreSlim();
    ~ParamStoreSlim() { clear(); }
    ParamStoreSlim(const ParamStoreSlim&) = delete;
    ParamStoreSlim& operator=(const ParamStoreSlim&) = delete;

    // Imperative declaration.
    ParamNodeSlim* declare_group(const char* path, const ParamMetaCore& meta);
    ParamNodeSlim* declare_param(const char* path, const ParamMetaCore& meta);

    // Lookup by path (e.g., "mixer/volume"). Returns nullptr if not found.
    ParamNodeSlim* resolve(const char* path);
    const ParamNodeSlim* resolve(const char* path) const;

    // Set/get value on a param node.
    bool set_value(const char* path, const ParamValue& val);
    const ParamValue* get_value(const char* path) const;

    // Tree root.
    ParamNodeSlim* root() { return &root_; }
    const ParamNodeSlim* root() const { return &root_; }

    // Collect and clear dirty flags.
    size_t collect_dirty(Vector<ParamNodeSlim*>& out);

    // Subscription management.
    bool subscribe(const char* local_path, const char* source_sku, const char* source_path);
    bool unsubscribe(const char* local_path, const char* source_sku, const char* source_path);

    // Give every node back (called on node disconnect / FLUSH).
    void clear();

    size_t node_count() const { return allocated_.size(); }

private:
    ParamNodeSlim root_;

    // Every node allocated, for clear()
    Vector<ParamNodeSlim*> allocated_;

    ParamNodeSlim* allocate_node();
    ParamNodeSlim* find_or_create_group(const char* path, size_t n);   // its first n characters
};

} // namespace dataflou
