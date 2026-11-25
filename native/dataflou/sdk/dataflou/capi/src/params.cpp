// params.cpp — the C interface (include/dataflou_c.h): params and groups
// declared and removed, their values set and read (here and on another
// node), the watched ones and their changes.

#include "node_internal.h"

#include "dataflou/value_cast.h"

#include <algorithm>

using namespace df_internal;

static_assert(static_cast<int>(ParamRole::Confidence) == DF_ROLE_CONFIDENCE, "df_role follows ParamRole");
static_assert(static_cast<int>(FullPolicy::Newest) == DF_FULL_NEWEST, "df_full follows FullPolicy");

namespace {

void own_write(df_node* n, const char* path);

// A param of this node by its path, or the array one element of which it
// names ("lights/3", 9.3): its shape (the element's), and the array's path
const ParamNode* target(const df_node* n, const char* path, ParamMetaCore& shape, std::string* array_path) {
    const ParamNode* p = n->node->local_params().resolve(path);
    if (p) {
        if (p->meta.kind != ParamKind::Param) return nullptr;
        shape = p->meta;
        if (array_path) *array_path = path;
        return p;
    }
    size_t index = 0;
    p = resolve_element(n->node->local_params(), path, index);
    if (!p) return nullptr;
    shape = element_meta(p->meta);
    if (array_path) {
        size_t len = 0;
        split_element(path, len, index);
        array_path->assign(path, len);
    }
    return p;
}

// `at`: the mesh time it is true at (API 0.6, "timed"); 0: none
bool set(df_node* n, const char* path, const ParamValue& value, uint64_t at = 0) {
    if (!n || !path) return false;
    ParamMetaCore shape;
    std::string whole;
    const ParamNode* p = target(n, path, shape, &whole);
    if (!p) return false;
    if (value.tag == ParamType::Array && value.s.empty() && !value.unknown) return false;   // a df_value: no elements
    ParamValue v = value;
    if (v.unknown) { v.tag = shape.type; v.of = shape.of; }
    if (v.tag != shape.type || shape.type == ParamType::Array) {
        if (v.tag != ParamType::Trigger || shape.type == ParamType::Array) {
            ParamValue cast;
            if (!cast_to(v, shape, cast, &p->value)) return false;
            v = cast;
        }
    }
    n->node->set_value_at(path, v, at);
    own_write(n, whole.c_str());
    return true;
}

// Our own write is not news for our own watchers
void own_write(df_node* n, const char* path) {
    const ParamNode* p = n->node->local_params().resolve(path);
    if (!p) return;
    for (auto& w : n->watches)
        if (w.path == path) w.epoch = p->change_epoch;
}

// `count` values laid out as `of` says (df_elem), as an array value
bool array_from_c(df_elem of, const void* values, size_t count, ParamValue& out) {
    if (of < DF_ELEM_FLOAT || of > DF_ELEM_BYTE || (!values && count) || count == 0 ||
        count > max_array_size(static_cast<ElemType>(of)))
        return false;
    const ElemType t = static_cast<ElemType>(of);
    if (!array_make(out, t, count, ParamValue{})) return false;
    std::memcpy(const_cast<char*>(out.s.c_str()), values, count * elem_size(t));
    if (t == ElemType::Bool)                         // a C bool is 0 or 1; any byte, here
        for (size_t i = 0; i < count; ++i) {
            char* b = const_cast<char*>(out.s.c_str()) + i;
            *b = *b ? 1 : 0;
        }
    return true;
}

} // namespace

extern "C" {

bool df_fire(df_node* n, const char* path) {
    ParamValue v;
    v.tag = ParamType::Trigger;
    return set(n, path, v);
}

bool df_set_bool(df_node* n, const char* path, bool value) {
    ParamValue v;
    v.tag = ParamType::Bool;
    v.b = value;
    return set(n, path, v);
}

bool df_set_number(df_node* n, const char* path, double value) {
    ParamValue v;
    v.tag = ParamType::Number;
    v.n = value;
    return set(n, path, v);
}

bool df_set_vector(df_node* n, const char* path, const float* values, int count) {
    if (!values || count < 2 || count > 4) return false;
    ParamValue v;
    v.tag = count == 2 ? ParamType::V2 : count == 3 ? ParamType::V3 : ParamType::V4;
    std::memcpy(v.v4, values, sizeof(float) * static_cast<size_t>(count));
    return set(n, path, v);
}

bool df_set_colour(df_node* n, const char* path, uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    ParamValue v;
    v.tag = ParamType::Colour;
    v.rgba[0] = r; v.rgba[1] = g; v.rgba[2] = b; v.rgba[3] = a;
    return set(n, path, v);
}

bool df_set_string(df_node* n, const char* path, const char* value) {
    ParamValue v;
    v.tag = ParamType::String;
    const char* text = value ? value : "";
    v.s.assign(text, std::min(std::strlen(text), static_cast<size_t>(v.s.max_size())));
    return set(n, path, v);
}

bool df_get(const df_node* n, const char* path, df_value* out) {
    if (!n || !path || !out) return false;
    const ParamValue* value = n->node->get_value(path);
    if (!value) {                                    // one element of an array (9.3)
        size_t index = 0;
        const ParamNode* p = resolve_element(n->node->local_params(), path, index);
        ParamValue x;
        if (!p || !array_get(p->value, index, x)) return false;
        to_c(x, out);
        return true;
    }
    to_c(*value, out);
    return true;
}

long df_get_text(const df_node* n, const char* path, char* out, size_t capacity) {
    if (!n || !path) return -1;
    const ParamValue* value = n->node->get_value(path);
    if (!value || (value->tag != ParamType::String && value->tag != ParamType::Blob)) return -1;
    const size_t len = value->s.size();
    if (out && capacity) {
        const size_t k = std::min(len, capacity - 1);
        std::memcpy(out, value->s.c_str(), k);
        out[k] = '\0';
    }
    return static_cast<long>(len);
}

bool df_set_remote_number(df_node* n, const char* sku, const char* path, double value) {
    if (!n || !sku || !path) return false;
    ParamValue v;
    v.tag = ParamType::Number;
    v.n = value;
    return static_cast<bool>(n->node->set_value_remote(sku, path, v));
}

bool df_declare(df_node* n, const char* path, const df_param_settings* s) {
    // A struct from an older header is smaller: what it lacks is left default
    if (!n || !path || !*path || !s || s->size < offsetof(df_param_settings, role)) return false;
    if (!n->loaded && !load(*n)) return false;      // the identity first
    ParamMeta meta;
    meta.kind = ParamKind::Param;
    meta.type = type_from_c(s->type);
    if (meta.type == ParamType::Array) {             // API 0.6: its shape
        if (s->size < offsetof(df_param_settings, count) + sizeof(s->count) ||
            s->of < DF_ELEM_FLOAT || s->of > DF_ELEM_BYTE || s->count < 1 || s->count > 65535)
            return false;
        meta.of = static_cast<ElemType>(s->of);
        meta.size = static_cast<uint16_t>(s->count);
    }
    // An array's range is one element's
    const ParamType range_type = meta.type == ParamType::Array ? elem_scalar(meta.of) : meta.type;
    meta.flow = static_cast<FlowDir>(s->flow);
    meta.access = Access::ReadWrite;                // the default, a source too (9.2)
    meta.mode = s->streaming ? StreamMode::Streaming : StreamMode::Discrete;
    meta.rate = static_cast<float>(s->rate);
    if (s->label) meta.label = s->label;
    if (s->unit) meta.unit = s->unit;
    if (s->desc) meta.desc = s->desc;
    meta.range_min.tag = meta.range_max.tag = meta.range_init.tag = range_type;
    if (s->has_range) {
        ParamValue lo, hi;
        if (value_cast(from_c(s->min), range_type, lo)) meta.range_min = ParamValueCore(lo);
        if (value_cast(from_c(s->max), range_type, hi)) meta.range_max = ParamValueCore(hi);
    }
    if (s->has_init) {
        ParamValue init;
        if (value_cast(from_c(s->init), range_type, init)) meta.range_init = ParamValueCore(init);
    }
    meta.ground_up = static_cast<float>(s->ground_up);
    meta.ground_down = static_cast<float>(s->ground_down);
    if (s->size >= offsetof(df_param_settings, role) + sizeof(s->role))
        meta.role = s->role >= DF_ROLE_NONE && s->role <= DF_ROLE_CONFIDENCE ? static_cast<ParamRole>(s->role)
                                                                             : ParamRole::None;
    if (s->size >= offsetof(df_param_settings, every_sample) + sizeof(s->every_sample))
        meta.every = s->every_sample;
    if (s->size >= offsetof(df_param_settings, write_only) + sizeof(s->write_only) &&
        s->write_only && meta.flow != FlowDir::Source)
        meta.access = Access::Write;
    // API 0.6: declared read (only this node sets it); with write_only, refused
    if (s->size >= offsetof(df_param_settings, read_only) + sizeof(s->read_only) && s->read_only) {
        if (meta.access == Access::Write) return false;
        meta.access = Access::Read;
    }
    if (s->size >= offsetof(df_param_settings, merge) + sizeof(s->merge))
        meta.merge = s->merge == DF_MERGE_HTP ? MergeMode::Htp
                   : s->merge == DF_MERGE_AVG ? MergeMode::Avg : MergeMode::Ltp;
    // The groups on its path, as a config would make them
    const std::string p = path;
    for (size_t slash = p.find('/'); slash != std::string::npos; slash = p.find('/', slash + 1)) {
        const std::string group = p.substr(0, slash);
        if (!n->node->local_params().resolve(group.c_str())) {
            ParamMeta g;
            g.kind = ParamKind::Group;
            n->node->declare_group(group.c_str(), g);
        }
    }
    if (!n->node->declare_param(path, meta)) return false;
    give_imported(*n, path);
    return true;
}

bool df_remove(df_node* n, const char* path) {
    if (!n || !path || !*path) return false;
    if (!n->loaded && !load(*n)) return false;
    return n->node->remove_param(path);
}

bool df_declare_group(df_node* n, const char* path, const df_group_settings* s) {
    if (!n || !path || !*path || !s || s->size < offsetof(df_group_settings, full)) return false;
    if (s->slots < 0 || s->slots > 255) return false;
    if (!n->loaded && !load(*n)) return false;
    ParamMeta meta;
    meta.kind = ParamKind::Group;
    if (s->label) meta.label = s->label;
    if (s->desc) meta.desc = s->desc;
    meta.slots = static_cast<uint8_t>(s->slots);
    if (s->size >= offsetof(df_group_settings, full) + sizeof(s->full) &&
        s->full >= DF_FULL_STEAL && s->full <= DF_FULL_NEWEST)
        meta.full = static_cast<FullPolicy>(s->full);
    if (s->size >= offsetof(df_group_settings, hold) + sizeof(s->hold)) {
        meta.grace_ms = static_cast<uint16_t>(std::clamp(s->grace_ms, 0, 65535));
        meta.hold = s->hold > 0 ? static_cast<float>(s->hold) : s->hold < 0 ? 0.0f : -1.0f;
    }
    if (s->size >= offsetof(df_group_settings, ids) + sizeof(s->ids))
        meta.ids = s->ids == DF_IDS_SOURCE ? IdsMode::Source : IdsMode::Auto;
    return n->node->declare_group(path, meta) != nullptr;   // parent groups are made
}

bool df_set(df_node* n, const char* path, const df_value* value) {
    return value && set(n, path, from_c(*value));
}

// --- Values that carry their time (API 0.6, core 9.3) ---

bool df_set_timed(df_node* n, const char* path, const df_value* value, double mesh_time) {
    if (!value || !(mesh_time >= 1.0)) return false;   // NaN and 0 too: no time is no stamp
    return set(n, path, from_c(*value), static_cast<uint64_t>(mesh_time));
}

double df_value_time(const df_node* n, const char* path) {
    if (!n || !path) return 0;
    return static_cast<double>(n->node->value_time(path));
}

void df_set_hold_horizon(df_node* n, double ms) {
    if (n && ms >= 0) n->node->set_hold_horizon(static_cast<uint64_t>(ms));
}

bool df_set_remote(df_node* n, const char* sku, const char* path, const df_value* value) {
    if (!n || !sku || !path || !value || value->type == DF_ARRAY) return false;
    return static_cast<bool>(n->node->set_value_remote(sku, path, from_c(*value)));
}

// --- Arrays (API 0.6, core 9.3) ---

bool df_set_array(df_node* n, const char* path, df_elem of, const void* values, size_t count) {
    ParamValue v;
    return n && path && array_from_c(of, values, count, v) && set(n, path, v);
}

bool df_set_remote_array(df_node* n, const char* sku, const char* path, df_elem of, const void* values,
                         size_t count) {
    ParamValue v;
    if (!n || !sku || !path || !array_from_c(of, values, count, v)) return false;
    return static_cast<bool>(n->node->set_value_remote(sku, path, v));
}

long df_get_array(const df_node* n, const char* path, df_elem of, void* out, size_t capacity) {
    if (!n || !path || of < DF_ELEM_FLOAT || of > DF_ELEM_BYTE) return -1;
    const ParamNode* p = n->node->local_params().resolve(path);
    if (!p || p->meta.kind != ParamKind::Param || p->meta.type != ParamType::Array) return -1;
    const size_t count = array_count(p->value);
    const size_t k = std::min(count, capacity);
    if (out && k) {
        const ElemType t = static_cast<ElemType>(of);
        if (t == p->value.of) {
            std::memcpy(out, p->value.s.c_str(), k * elem_size(t));
        } else {                                     // each element cast to `of`
            ParamValue as;
            if (!array_make(as, t, k, ParamValue{})) return -1;
            ParamValue x;
            for (size_t i = 0; i < k; ++i)
                if (array_get(p->value, i, x)) array_set(as, i, x);
            std::memcpy(out, as.s.c_str(), k * elem_size(t));
        }
    }
    return static_cast<long>(count);
}

bool df_array_info(const df_node* n, const char* path, df_elem* of, size_t* count) {
    if (!n || !path) return false;
    const ParamNode* p = n->node->local_params().resolve(path);
    if (!p || p->meta.kind != ParamKind::Param || p->meta.type != ParamType::Array) return false;
    if (of) *of = static_cast<df_elem>(p->meta.of);
    if (count) *count = p->meta.size;
    return true;
}

bool df_set_element(df_node* n, const char* path, size_t index, const df_value* value) {
    if (!n || !path || !value || value->type == DF_ARRAY || index >= 65535) return false;
    const std::string element = std::string(path) + "/" + std::to_string(index + 1);
    return set(n, element.c_str(), from_c(*value));
}

bool df_get_element(const df_node* n, const char* path, size_t index, df_value* out) {
    if (!n || !path || !out) return false;
    const ParamNode* p = n->node->local_params().resolve(path);
    ParamValue x;
    if (!p || p->meta.kind != ParamKind::Param || p->meta.type != ParamType::Array ||
        !array_get(p->value, index, x))
        return false;
    to_c(x, out);
    return true;
}

void df_node_on_array(df_node* n, df_array_fn fn, void* context) {
    if (!n) return;
    n->on_array = fn;
    n->array_context = context;
    // Every-sample arrays, as df_node_on_change keeps them
    n->node->on_sample([](const char* path, const ParamValue& v, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        for (const auto& w : self->watches)
            if (w.path == path) { self->samples.emplace_back(path, v); break; }
    }, n);
}

static ParamValue bytes_value(df_type type, const void* data, size_t len) {
    ParamValue v;
    v.tag = type == DF_BLOB ? ParamType::Blob : ParamType::String;
    v.s.assign(static_cast<const char*>(data), std::min(len, static_cast<size_t>(v.s.max_size())));
    return v;
}

bool df_set_bytes(df_node* n, const char* path, df_type type, const void* data, size_t len) {
    if (!n || !path || (type != DF_STRING && type != DF_BLOB) || (!data && len)) return false;
    return set(n, path, bytes_value(type, data, len));
}

bool df_set_remote_bytes(df_node* n, const char* sku, const char* path, df_type type, const void* data,
                         size_t len) {
    if (!n || !sku || !path || (type != DF_STRING && type != DF_BLOB) || (!data && len)) return false;
    return static_cast<bool>(n->node->set_value_remote(sku, path, bytes_value(type, data, len)));
}

bool df_watch(df_node* n, const char* path) {
    if (!n || !path) return false;
    for (const auto& w : n->watches)
        if (w.path == path) return true;
    df_node::Watch w;
    w.path = path;
    if (const ParamNode* p = n->node->local_params().resolve(path)) w.epoch = p->change_epoch;
    n->watches.push_back(w);
    return true;
}

void df_node_on_change(df_node* n, df_change_fn fn, void* context) {
    if (!n) return;
    n->on_change = fn;
    n->change_context = context;
    n->node->on_sample([](const char* path, const ParamValue& v, void* ctx) {
        auto* self = static_cast<df_node*>(ctx);
        for (const auto& w : self->watches)
            if (w.path == path) { self->samples.emplace_back(path, v); break; }
    }, n);
}

} // extern "C"
