#include "dataflou/param.h"
#include "dataflou/value_cast.h"
#include <cstring>
#include <cstdio>


namespace dataflou {

// Check if a name contains spaces (illegal in param names).
static bool name_has_spaces(const char* s) {
    while (*s) { if (*s == ' ') return true; ++s; }
    return false;
}

template <typename Meta>
ParamStoreT<Meta>::ParamStoreT() {
    root_.meta.kind = ParamKind::Group;
    root_.meta.name = "root";
    if constexpr (std::is_base_of_v<ParamMetaCore, ParamMeta> &&
                  std::is_same_v<Meta, ParamMeta>) {
        root_.meta.label = "root";
    }
}

template <typename Meta>
ParamStoreT<Meta>::ParamStoreT(const ParamStoreT& other) : ParamStoreT() {
    *this = other;
}

// Copy the tree under src into dst (nodes removed from the tree are not
// copied: they are no longer part of it).
template <typename Meta>
void ParamStoreT<Meta>::clone_children(NodeType* dst, const NodeType* src) {
    for (const NodeType* child : src->children) {
        NodeType* n = allocate_node();
        if (!n) return;                                // out of memory: the rest is left out
        n->meta = child->meta;
        n->value = child->value;
        n->stamp = child->stamp;
        n->change_epoch = child->change_epoch;
        n->dirty = child->dirty;
        n->error = child->error;
        n->subscriptions = child->subscriptions;
        if (!attach(dst, n)) return;
        clone_children(n, child);
    }
}

template <typename Meta>
ParamStoreT<Meta>& ParamStoreT<Meta>::operator=(const ParamStoreT& other) {
    if (this == &other) return *this;
    clear();
    classes_ = other.classes_;
    class_names_ = other.class_names_;
    root_.meta = other.root_.meta;
    root_.value = other.root_.value;
    root_.stamp = other.root_.stamp;
    root_.change_epoch = other.root_.change_epoch;
    root_.dirty = other.root_.dirty;
    root_.subscriptions = other.root_.subscriptions;
    clone_children(&root_, &other.root_);
    return *this;
}

template <typename Meta>
void ParamStoreT<Meta>::clear() {
    nodes_.clear();
    classes_.clear();
    class_names_.clear();
    root_.children.clear();
    root_.subscriptions.clear();
    root_.meta = Meta{};
    root_.meta.kind = ParamKind::Group;
    root_.meta.name = "root";
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        root_.meta.label = "root";
    }
    root_.value = ParamValue{};
    root_.stamp = 0;
    root_.change_epoch = 0;
    root_.dirty = false;
    root_.error = false;
    root_.parent = nullptr;
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::allocate_node() {
    return nodes_.emplace_back();
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::attach(NodeType* parent, NodeType* node) {
    node->parent = parent;
    if (parent->children.push_back(node)) return node;
    // The group can't take one more: the node goes, rather than live detached
    nodes_.erase(nodes_.end() - 1);
    return nullptr;
}

// Split the first `n` characters of a path like "mixer/volume" into
// segments, in place: no copy, so a segment is as long as the name it
// matches (a name is Text, of any length).
// Calls visitor(segment, length, is_last) for each segment.
template <typename Fn>
static void walk_path(const char* path, size_t n, Fn&& visitor) {
    const char* p = path;
    const char* const end = path + n;
    while (p < end) {
        const char* slash = p;
        while (slash < end && *slash != '/') ++slash;
        const size_t len = static_cast<size_t>(slash - p);
        if (len == 0) { ++p; continue; }            // a leading or doubled slash
        const bool is_last = slash == end;
        visitor(p, len, is_last);
        p = is_last ? slash : slash + 1;
    }
}

template <typename Fn>
static void walk_path(const char* path, Fn&& visitor) {
    walk_path(path, path ? std::strlen(path) : 0, visitor);
}

// A node's name is this segment, whole
static bool name_is(const Text& name, const char* seg, size_t len) {
    return name.size() == len && std::memcmp(name.c_str(), seg, len) == 0;
}

// Longer than a path may be (param.h): the declaration is refused
static bool path_too_long(const char* path) {
    if (!path) return false;
    if (*path == '/') ++path;
    return std::strlen(path) > kMaxPathLength;
}

// The last segment of a path, and the length of what is above it (0: none)
static const char* last_segment(const char* path, size_t& parent_len) {
    const char* last_slash = nullptr;
    for (const char* p = path; *p; ++p) {
        if (*p == '/') last_slash = p;
    }
    parent_len = last_slash ? static_cast<size_t>(last_slash - path) : 0;
    const char* seg = last_slash ? last_slash + 1 : path;
    if (*seg == '/') ++seg;
    return seg;
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::find_or_create_group(const char* path, size_t n) {
    NodeType* current = &root_;

    walk_path(path, n, [&](const char* seg, size_t len, bool /*is_last*/) {
        if (!current) return;                      // a parent didn't fit
        // Look for existing child with this name
        for (auto* child : current->children) {
            if (name_is(child->meta.name, seg, len)) {
                current = child;
                return;
            }
        }
        // Create new group node
        NodeType* node = allocate_node();
        if (!node) { current = nullptr; return; }
        node->meta.kind = ParamKind::Group;
        if (!node->meta.name.assign(seg, len)) {   // out of memory: not a shorter name
            nodes_.erase(nodes_.end() - 1);
            current = nullptr;
            return;
        }
        if constexpr (std::is_same_v<Meta, ParamMeta>) {
            node->meta.label = node->meta.name;
        }
        current = attach(current, node);
    });

    return current;
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::declare_group(const char* path, const Meta& meta) {
    // Path gives the full location; the last segment is the group name.
    // Parent groups are auto-created.
    NodeType* parent = &root_;
    NodeType* result = nullptr;

    if (path_too_long(path)) return nullptr;      // refused, never cut (kMaxPathLength)
    size_t parent_len = 0;
    const char* seg = last_segment(path, parent_len);
    if (parent_len > 0) {
        parent = find_or_create_group(path, parent_len);
        if (!parent) return nullptr;
    }

    // Check if child already exists (keyed by name, not label)

    for (auto* child : parent->children) {
        if (child->meta.name.compare(seg) == 0) {
            child->meta = meta;
            if (child->meta.name.empty()) child->meta.name = seg;
            return child;
        }
    }

    result = allocate_node();
    if (!result) return nullptr;
    result->meta = meta;
    result->meta.kind = ParamKind::Group;
    if (result->meta.name.empty() && !result->meta.name.assign(seg)) {
        nodes_.erase(nodes_.end() - 1);           // out of memory: not a shorter name
        return nullptr;
    }
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        if (result->meta.label.empty()) {
            result->meta.label = seg;
        }
    }
    if (name_has_spaces(result->meta.name.c_str())) {
        result->error = true;
    }
    return attach(parent, result);
}

// An array whose shape is none (no size, too large for a stream packet, an
// element type not known): refused at declaration (9.3)
static bool bad_array(const ParamMetaCore& m) {
    return m.type == ParamType::Array && !valid_array(m.of, m.size);
}

// A redeclaration that changes the value's shape: its type, an array's
// element type or size
static bool same_shape(const ParamMetaCore& a, ParamType type, ElemType of, uint16_t size) {
    return a.type == type && (type != ParamType::Array || (a.of == of && a.size == size));
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::declare_param(const char* path, const Meta& meta) {
    NodeType* parent = &root_;
    if (path_too_long(path)) return nullptr;      // refused, never cut (kMaxPathLength)
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        if (!meta.inherits.empty()) {             // an array's shape may be its class's
            Meta m = meta;
            if (const Meta* cls = find_class(meta.inherits.c_str())) apply_class_defaults(m, *cls);
            if (bad_array(m)) return nullptr;
        } else if (bad_array(meta)) {
            return nullptr;
        }
    } else if (bad_array(meta)) {
        return nullptr;
    }
    size_t parent_len = 0;
    const char* seg = last_segment(path, parent_len);
    if (parent_len > 0) {
        parent = find_or_create_group(path, parent_len);
        if (!parent) return nullptr;
    }

    // Check if param already exists (keyed by name)
    for (auto* child : parent->children) {
        if (child->meta.name.compare(seg) == 0) {
            // Re-declare: replace metadata, keep the current value.
            const ParamType old_type = child->meta.type;
            const ElemType old_of = child->meta.of;
            const uint16_t old_size = child->meta.size;
            child->meta = meta;
            if (child->meta.name.empty()) child->meta.name = seg;
            if constexpr (std::is_same_v<Meta, ParamMeta>) {
                if (!meta.inherits.empty()) {
                    if (const Meta* cls = find_class(meta.inherits.c_str()))
                        apply_class_defaults(child->meta, *cls);
                }
            }
            // A type change invalidates the old value (an array's shape too).
            if (!same_shape(child->meta, old_type, old_of, old_size))
                child->value = initial_value(child->meta);
            return child;
        }
    }

    NodeType* node = allocate_node();
    if (!node) return nullptr;
    node->meta = meta;
    node->meta.kind = ParamKind::Param;
    if (node->meta.name.empty() && !node->meta.name.assign(seg)) {
        nodes_.erase(nodes_.end() - 1);           // out of memory: not a shorter name
        return nullptr;
    }
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        if (node->meta.label.empty()) {
            node->meta.label = seg;
        }
    }
    if (name_has_spaces(node->meta.name.c_str())) {
        node->error = true;
    }
    // Apply class defaults if inherits is set (only for full ParamMeta)
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        if (!meta.inherits.empty()) {
            const Meta* cls = find_class(meta.inherits.c_str());
            if (cls) {
                apply_class_defaults(node->meta, *cls);
            }
        }
    }
    // Set initial value (ensure tag matches declared type, since range_init
    // may not have been explicitly provided and defaults to Number; an
    // array: every element its init)
    node->value = initial_value(node->meta);
    return attach(parent, node);
}

template <typename Meta>
void ParamStoreT<Meta>::define_class(const char* name, const Meta& meta) {
    // Check if class already exists
    for (size_t i = 0; i < class_names_.size(); ++i) {
        if (class_names_[i].compare(name) == 0) {
            classes_[i] = meta;
            return;
        }
    }
    if (!class_names_.push_back(Text(name))) return;
    if (!classes_.push_back(meta)) class_names_.pop_back();
}

template <typename Meta>
const Meta* ParamStoreT<Meta>::find_class(const char* name) const {
    for (size_t i = 0; i < class_names_.size(); ++i) {
        if (class_names_[i].compare(name) == 0) {
            return &classes_[i];
        }
    }
    return nullptr;
}

// A range bound holds no value when every byte of its union is zero (the
// default): a "0..0" range carries no information, so it counts as unset.
static bool range_value_unset(const ParamValueCore& v) {
    static const ParamValueCore zero{};
    return std::memcmp(&v.v4, &zero.v4, sizeof(v.v4)) == 0;
}

template <typename Meta>
void ParamStoreT<Meta>::apply_class_defaults(Meta& meta, const Meta& cls) {
    // Only apply fields from cls that weren't explicitly set in meta.
    // Heuristic: if meta field is at default, copy from cls.
    if (meta.type == ParamType::Number && cls.type != ParamType::Number)
        meta.type = cls.type;
    if (meta.type == ParamType::Array && cls.type == ParamType::Array && meta.size == 0) {
        meta.of = cls.of;                         // an array's shape from its class
        meta.size = cls.size;
    }
    if (meta.mode == StreamMode::Discrete && cls.mode != StreamMode::Discrete)
        meta.mode = cls.mode;
    if (meta.flow == FlowDir::Source && cls.flow != FlowDir::Source)
        meta.flow = cls.flow;
    if (meta.rate == 0.0f && cls.rate != 0.0f)
        meta.rate = cls.rate;
    if (meta.access == Access::ReadWrite && cls.access != Access::ReadWrite)
        meta.access = cls.access;
    if (!meta.grounds() && cls.grounds()) {
        meta.ground_up = cls.ground_up;
        meta.ground_down = cls.ground_down;
    }
    if constexpr (std::is_same_v<Meta, ParamMeta>) {
        if (meta.unit.empty() && !cls.unit.empty())
            meta.unit = cls.unit;
    }
    if (meta.nature == Nature::Lin && cls.nature != Nature::Lin)
        meta.nature = cls.nature;
    if (meta.topology == Topology::Span && cls.topology != Topology::Span)
        meta.topology = cls.topology;
    if (!meta.hardware && cls.hardware)
        meta.hardware = cls.hardware;
    if (meta.merge == MergeMode::Ltp && cls.merge != MergeMode::Ltp)
        meta.merge = cls.merge;
    // Range: inherited when the param declares none (min and max unset) and
    // the class range has the same type. Without this, a param relying on its
    // class for its range (e.g. "inherits": "fader") was declared 0..0.
    if (meta.type == cls.type &&
        range_value_unset(meta.range_min) && range_value_unset(meta.range_max)) {
        meta.range_min = cls.range_min;
        meta.range_max = cls.range_max;
        if (range_value_unset(meta.range_init))
            meta.range_init = cls.range_init;
    }
}

template <typename Meta>
typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::resolve(const char* path) {
    NodeType* current = &root_;

    walk_path(path, [&](const char* seg, size_t len, bool /*is_last*/) {
        if (!current) return;
        for (auto* child : current->children) {
            if (name_is(child->meta.name, seg, len)) {
                current = child;
                return;
            }
        }
        current = nullptr;
    });

    return current;
}

template <typename Meta>
const typename ParamStoreT<Meta>::NodeType* ParamStoreT<Meta>::resolve(const char* path) const {
    return const_cast<ParamStoreT*>(this)->resolve(path);
}

// A value written into a param node: a trigger fires; an array takes it in
// its own shape (cast_to), whole, or one element ("lights/3", 9.3)
template <typename N, typename Store>
static bool write_value(Store& store, const char* path, const ParamValue& val) {
    N* node = store.resolve(path);
    if (!node) {
        size_t i = 0;
        node = resolve_element(store, path, i);
        if (!node) return false;
        if (node->value.unknown || array_count(node->value) != node->meta.size)
            node->value = initial_value(node->meta);
        if (!array_set(node->value, i, val)) return false;
        node->value.unknown = false;
    } else if (node->meta.kind != ParamKind::Param) {
        return false;
    } else if (node->meta.type == ParamType::Trigger) {
        fire_into(node->value);                    // any write fires it
    } else if (node->meta.type == ParamType::Array) {
        ParamValue v;
        if (!cast_to(val, node->meta, v, &node->value)) return false;
        node->value = static_cast<ParamValue&&>(v);
    } else {
        node->value = val;
    }
    node->stamp = 0;                               // a plain write: true now (9.3)
    node->dirty = true;
    ++node->change_epoch;
    return true;
}

template <typename Meta>
bool ParamStoreT<Meta>::set_value(const char* path, const ParamValue& val) {
    return write_value<NodeType>(*this, path, val);
}

template <typename Meta>
const ParamValue* ParamStoreT<Meta>::get_value(const char* path) const {
    const NodeType* node = resolve(path);
    if (!node || node->meta.kind != ParamKind::Param) return nullptr;
    return &node->value;
}

template <typename Meta>
size_t ParamStoreT<Meta>::collect_dirty(Vector<NodeType*>& out) {
    size_t count = 0;
    for (auto& node : nodes_) {
        if (node.dirty && out.push_back(&node)) {
            node.dirty = false;
            ++count;
        }
    }
    return count;
}

template <typename Meta>
bool ParamStoreT<Meta>::load_from_json(const char* /*json_string*/) {
    // Implemented in config_loader.cpp via friend/free function
    return false;
}

template <typename Meta>
bool ParamStoreT<Meta>::remove(const char* path) {
    NodeType* node = resolve(path);
    if (!node || node == &root_) return false;
    NodeType* parent = node->parent;
    if (!parent) return false;

    for (size_t i = 0; i < parent->children.size(); ++i) {
        if (parent->children[i] == node) {
            parent->children.erase(parent->children.begin() + static_cast<ptrdiff_t>(i));
            node->parent = nullptr;
            return true;
        }
    }
    return false;
}

template <typename Meta>
bool ParamStoreT<Meta>::subscribe(const char* local_path, const char* source_sku, const char* source_path,
                                  ConnectionId id) {
    NodeType* node = resolve(local_path);
    if (!node || node->meta.kind != ParamKind::Param) return false;

    // Check for duplicate (it keeps its id; one without gets this one)
    for (auto& sub : node->subscriptions) {
        if (sub.source_sku == source_sku && sub.source_path == source_path) {
            if (sub.id.empty()) sub.id = id;
            return true; // already subscribed
        }
    }

    ParamSubscription sub;
    sub.source_sku = source_sku;
    sub.source_path = source_path;
    sub.id = id;
    return node->subscriptions.push_back(sub);
}

template <typename Meta>
bool ParamStoreT<Meta>::unsubscribe(const char* local_path, const char* source_sku, const char* source_path) {
    NodeType* node = resolve(local_path);
    if (!node) return false;
    for (size_t i = 0; i < node->subscriptions.size(); ++i) {
        if (node->subscriptions[i].source_sku == source_sku &&
            node->subscriptions[i].source_path == source_path) {
            node->subscriptions.erase(node->subscriptions.begin() + static_cast<ptrdiff_t>(i));
            return true;
        }
    }
    return false;
}

// Explicit template instantiations
template class ParamStoreT<ParamMeta>;

// ---------------------------------------------------------------------------
// ParamStoreSlim — the slim store, each node from the core's memory
// ---------------------------------------------------------------------------

ParamStoreSlim::ParamStoreSlim() {
    root_.meta.kind = ParamKind::Group;
    root_.meta.name = "root";
}

ParamNodeSlim* ParamStoreSlim::allocate_node() {
    auto* node = Memory::create<ParamNodeSlim>();
    if (!node) return nullptr;
    if (!allocated_.push_back(node)) { Memory::destroy(node); return nullptr; }
    return node;
}

// Attach a fresh node under parent; drops it if the parent can't hold it.
static ParamNodeSlim* attach_slim(ParamNodeSlim* parent, ParamNodeSlim* node,
                                  Vector<ParamNodeSlim*>& allocated) {
    node->parent = parent;
    if (parent->children.push_back(node)) return node;
    allocated.pop_back();                          // node is the last allocated
    Memory::destroy(node);
    return nullptr;
}

ParamNodeSlim* ParamStoreSlim::find_or_create_group(const char* path, size_t n) {
    ParamNodeSlim* current = &root_;

    walk_path(path, n, [&](const char* seg, size_t len, bool /*is_last*/) {
        if (!current) return;                      // a parent didn't fit
        for (auto* child : current->children) {
            if (name_is(child->meta.name, seg, len)) {
                current = child;
                return;
            }
        }
        ParamNodeSlim* node = allocate_node();
        if (!node) { current = nullptr; return; }
        node->meta.kind = ParamKind::Group;
        if (!node->meta.name.assign(seg, len)) {   // out of memory: not a shorter name
            allocated_.pop_back();
            Memory::destroy(node);
            current = nullptr;
            return;
        }
        current = attach_slim(current, node, allocated_);
    });

    return current;
}

ParamNodeSlim* ParamStoreSlim::declare_group(const char* path, const ParamMetaCore& meta) {
    ParamNodeSlim* parent = &root_;

    if (path_too_long(path)) return nullptr;      // refused, never cut (kMaxPathLength)
    size_t parent_len = 0;
    const char* seg = last_segment(path, parent_len);
    if (parent_len > 0) {
        parent = find_or_create_group(path, parent_len);
        if (!parent) return nullptr;
    }

    for (auto* child : parent->children) {
        if (child->meta.name.compare(seg) == 0) {
            child->meta = meta;
            if (child->meta.name.empty()) child->meta.name = seg;
            return child;
        }
    }

    ParamNodeSlim* result = allocate_node();
    if (!result) return nullptr;
    result->meta = meta;
    result->meta.kind = ParamKind::Group;
    if (result->meta.name.empty() && !result->meta.name.assign(seg)) {
        allocated_.pop_back();                    // out of memory: not a shorter name
        Memory::destroy(result);
        return nullptr;
    }
    if (name_has_spaces(result->meta.name.c_str())) {
        result->error = true;
    }
    return attach_slim(parent, result, allocated_);
}

ParamNodeSlim* ParamStoreSlim::declare_param(const char* path, const ParamMetaCore& meta) {
    ParamNodeSlim* parent = &root_;
    if (path_too_long(path)) return nullptr;      // refused, never cut (kMaxPathLength)
    size_t parent_len = 0;
    const char* seg = last_segment(path, parent_len);
    if (parent_len > 0) {
        parent = find_or_create_group(path, parent_len);
        if (!parent) return nullptr;
    }

    if (bad_array(meta)) return nullptr;
    for (auto* child : parent->children) {
        if (child->meta.name.compare(seg) == 0) {
            const bool same = same_shape(meta, child->meta.type, child->meta.of, child->meta.size);
            child->meta = meta;
            if (child->meta.name.empty()) child->meta.name = seg;
            if (!same) child->value = initial_value(child->meta);
            return child;
        }
    }

    ParamNodeSlim* node = allocate_node();
    if (!node) return nullptr;
    node->meta = meta;
    node->meta.kind = ParamKind::Param;
    if (node->meta.name.empty() && !node->meta.name.assign(seg)) {
        allocated_.pop_back();                    // out of memory: not a shorter name
        Memory::destroy(node);
        return nullptr;
    }
    if (name_has_spaces(node->meta.name.c_str())) {
        node->error = true;
    }
    // No class inheritance for slim nodes
    node->value = initial_value(node->meta);
    return attach_slim(parent, node, allocated_);
}

ParamNodeSlim* ParamStoreSlim::resolve(const char* path) {
    ParamNodeSlim* current = &root_;

    walk_path(path, [&](const char* seg, size_t len, bool /*is_last*/) {
        if (!current) return;
        for (auto* child : current->children) {
            if (name_is(child->meta.name, seg, len)) {
                current = child;
                return;
            }
        }
        current = nullptr;
    });

    return current;
}

const ParamNodeSlim* ParamStoreSlim::resolve(const char* path) const {
    return const_cast<ParamStoreSlim*>(this)->resolve(path);
}

bool ParamStoreSlim::set_value(const char* path, const ParamValue& val) {
    return write_value<ParamNodeSlim>(*this, path, val);
}

const ParamValue* ParamStoreSlim::get_value(const char* path) const {
    const ParamNodeSlim* node = resolve(path);
    if (!node || node->meta.kind != ParamKind::Param) return nullptr;
    return &node->value;
}

size_t ParamStoreSlim::collect_dirty(Vector<ParamNodeSlim*>& out) {
    size_t count = 0;
    for (auto* node : allocated_) {
        if (node->dirty && out.push_back(node)) {
            node->dirty = false;
            ++count;
        }
    }
    return count;
}

bool ParamStoreSlim::subscribe(const char* local_path, const char* source_sku, const char* source_path) {
    ParamNodeSlim* node = resolve(local_path);
    if (!node || node->meta.kind != ParamKind::Param) return false;

    for (const auto& sub : node->subscriptions) {
        if (sub.source_sku == source_sku && sub.source_path == source_path) {
            return true;
        }
    }
    ParamSubscription sub;
    sub.source_sku = source_sku;
    sub.source_path = source_path;
    return node->subscriptions.push_back(sub);
}

bool ParamStoreSlim::unsubscribe(const char* local_path, const char* source_sku, const char* source_path) {
    ParamNodeSlim* node = resolve(local_path);
    if (!node) return false;

    for (size_t i = 0; i < node->subscriptions.size(); ++i) {
        if (node->subscriptions[i].source_sku == source_sku &&
            node->subscriptions[i].source_path == source_path) {
            node->subscriptions.erase(node->subscriptions.begin() + static_cast<ptrdiff_t>(i));
            return true;
        }
    }
    return false;
}

void ParamStoreSlim::clear() {
    for (auto* node : allocated_) Memory::destroy(node);
    allocated_.clear();
    root_.children.clear();
}

} // namespace dataflou
