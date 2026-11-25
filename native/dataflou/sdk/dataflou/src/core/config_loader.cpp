#include "dataflou/node.h"
#include "dataflou/param.h"
#include "dataflou/types.h"
#include "dataflou/array.h"
#include <cJSON.h>
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace dataflou {

// --- JSON helpers (enum parsers from types.h) ---
//
// The loader is lenient about shapes produced by Max dictionaries (the Max
// external can load its config from a dict): Max has no boolean type, so
// true/false arrive as 1/0, and non-string values must not be read as strings.

static bool json_bool(const cJSON* item) {
    return cJSON_IsTrue(item) || (cJSON_IsNumber(item) && item->valuedouble != 0.0);
}

static const char* json_str(const cJSON* item) {
    return cJSON_IsString(item) ? item->valuestring : nullptr;
}

// Array of objects; a lone object is accepted as a one-element array.
static int json_count(const cJSON* item) {
    if (cJSON_IsArray(item)) return cJSON_GetArraySize(item);
    return cJSON_IsObject(item) ? 1 : 0;
}

static cJSON* json_at(cJSON* item, int i) {
    return cJSON_IsArray(item) ? cJSON_GetArrayItem(item, i) : item;
}

static ParamValue parse_value(cJSON* item, ParamType type) {
    ParamValue val;
    val.tag = type;
    if (!item) return val;

    switch (type) {
    case ParamType::Bool:
        val.b = json_bool(item);
        break;
    case ParamType::Number:
        val.n = item->valuedouble;
        break;
    case ParamType::String:
    case ParamType::Blob:                  // as the snapshots write one
        if (cJSON_IsString(item)) {
            val.s = item->valuestring;
        }
        break;
    case ParamType::V2:
        if (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 2) {
            val.v2[0] = static_cast<float>(cJSON_GetArrayItem(item, 0)->valuedouble);
            val.v2[1] = static_cast<float>(cJSON_GetArrayItem(item, 1)->valuedouble);
        }
        break;
    case ParamType::V3:
        if (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 3) {
            val.v3[0] = static_cast<float>(cJSON_GetArrayItem(item, 0)->valuedouble);
            val.v3[1] = static_cast<float>(cJSON_GetArrayItem(item, 1)->valuedouble);
            val.v3[2] = static_cast<float>(cJSON_GetArrayItem(item, 2)->valuedouble);
        }
        break;
    case ParamType::V4:
        if (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 4) {
            val.v4[0] = static_cast<float>(cJSON_GetArrayItem(item, 0)->valuedouble);
            val.v4[1] = static_cast<float>(cJSON_GetArrayItem(item, 1)->valuedouble);
            val.v4[2] = static_cast<float>(cJSON_GetArrayItem(item, 2)->valuedouble);
            val.v4[3] = static_cast<float>(cJSON_GetArrayItem(item, 3)->valuedouble);
        }
        break;
    case ParamType::Colour:
        if (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 3) {
            // [R, G, B, A], or [R, G, B] opaque (as the visualizer sends one)
            val.rgba[0] = static_cast<uint8_t>(cJSON_GetArrayItem(item, 0)->valueint);
            val.rgba[1] = static_cast<uint8_t>(cJSON_GetArrayItem(item, 1)->valueint);
            val.rgba[2] = static_cast<uint8_t>(cJSON_GetArrayItem(item, 2)->valueint);
            val.rgba[3] = cJSON_GetArraySize(item) >= 4
                ? static_cast<uint8_t>(cJSON_GetArrayItem(item, 3)->valueint) : 255;
        } else if (cJSON_IsString(item)) {
            // Parse "#RRGGBBAA" hex string
            const char* hex = item->valuestring;
            if (hex && hex[0] == '#' && strlen(hex) >= 9) {
                auto hex2 = [](char hi, char lo) -> uint8_t {
                    auto nibble = [](char c) -> uint8_t {
                        if (c >= '0' && c <= '9') return static_cast<uint8_t>(c - '0');
                        if (c >= 'a' && c <= 'f') return static_cast<uint8_t>(c - 'a' + 10);
                        if (c >= 'A' && c <= 'F') return static_cast<uint8_t>(c - 'A' + 10);
                        return 0;
                    };
                    return static_cast<uint8_t>((nibble(hi) << 4) | nibble(lo));
                };
                val.rgba[0] = hex2(hex[1], hex[2]);
                val.rgba[1] = hex2(hex[3], hex[4]);
                val.rgba[2] = hex2(hex[5], hex[6]);
                val.rgba[3] = hex2(hex[7], hex[8]);
            }
        }
        break;
    default:
        break;
    }
    return val;
}

// The same, for the desktop's other JSON documents (desktop/world_json.h)
ParamValue value_from_json(const cJSON* item, ParamType type) {
    return parse_value(const_cast<cJSON*>(item), type);
}

// A value for a param of shape `m`: an array's is a JSON array of its
// elements (numbers, bools, colours as "#RRGGBBAA" or [R, G, B, A]), the
// first ones if it has fewer, the others at init; one value fills them all
// (9.3). Any other: as value_from_json.
// A colour as [R, G, B, A] is one element, not four
static bool one_element(const cJSON* item, const ParamMetaCore& m) {
    return !cJSON_IsArray(item) ||
           (m.of == ElemType::Colour && cJSON_GetArraySize(item) == 4 &&
            cJSON_IsNumber(cJSON_GetArrayItem(item, 0)) && m.size != 4);
}

ParamValue value_from_json(const cJSON* item, const ParamMetaCore& m) {
    if (m.type != ParamType::Array) return value_from_json(item, m.type);
    ParamValue out = initial_value(m);
    if (!item || cJSON_IsNull(item)) return out;
    const ParamType et = elem_scalar(m.of);
    const bool one = one_element(item, m);
    if (one) {
        const ParamValue x = parse_value(const_cast<cJSON*>(item), et);
        for (size_t i = 0; i < m.size; ++i) array_put(out, i, x);
        return out;
    }
    const int n = cJSON_GetArraySize(item);
    for (int i = 0; i < n && static_cast<size_t>(i) < m.size; ++i)
        array_put(out, static_cast<size_t>(i), parse_value(cJSON_GetArrayItem(item, i), et));
    return out;
}

// The same as a set gives it (9.3): an array's list is its first elements
// alone, so that the param it is written to keeps the others (as a node's
// own write keeps them: df_set_array, SETVAL); one value fills them all.
ParamValue value_for_set(const cJSON* item, const ParamMetaCore& m) {
    if (m.type != ParamType::Array || !item || cJSON_IsNull(item) || one_element(item, m))
        return value_from_json(item, m);
    const ParamType et = elem_scalar(m.of);
    const size_t n = std::min(static_cast<size_t>(cJSON_GetArraySize(item)), static_cast<size_t>(m.size));
    ParamValue out;
    if (!array_make(out, m.of, n, ParamValue{})) return value_from_json(item, m);
    for (size_t i = 0; i < n; ++i)
        array_put(out, i, parse_value(cJSON_GetArrayItem(item, static_cast<int>(i)), et));
    return out;
}

// A saved value a param of that type can take: a number or a bool for a
// number or a bool, text for text or a blob, a list long enough for a
// vector, a list or "#RRGGBBAA" for a colour; an array reads what it can
static bool value_fits(const cJSON* item, ParamType type) {
    switch (type) {
    case ParamType::Number:
    case ParamType::Bool:   return cJSON_IsNumber(item) || cJSON_IsBool(item);
    case ParamType::String:
    case ParamType::Blob:   return cJSON_IsString(item);
    case ParamType::V2:     return cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 2;
    case ParamType::V3:     return cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 3;
    case ParamType::V4:     return cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 4;
    case ParamType::Colour: return (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 3) || cJSON_IsString(item);
    case ParamType::Array:  return true;
    default:                return false;
    }
}

static void parse_meta(cJSON* obj, ParamMeta& meta) {
    cJSON* item;
    const char* s;

    if ((s = json_str(cJSON_GetObjectItem(obj, "uuid"))))
        meta.uuid = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "label"))))
        meta.label = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "desc"))))
        meta.desc = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "gui"))))
        meta.gui_hint = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "inherits"))))
        meta.inherits = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "type"))))
        meta.type = parse_param_type(s);
    // An array (9.3): its element type and size
    if ((s = json_str(cJSON_GetObjectItem(obj, "of"))))
        parse_elem_type(s, meta.of);
    if ((item = cJSON_GetObjectItem(obj, "size")) && cJSON_IsNumber(item))
        meta.size = static_cast<uint16_t>(std::min(65535.0, std::max(0.0, item->valuedouble)));
    if ((s = json_str(cJSON_GetObjectItem(obj, "mode"))))
        meta.mode = parse_stream_mode(s);
    if ((s = json_str(cJSON_GetObjectItem(obj, "flow"))))
        meta.flow = parse_flow_dir(s);
    if ((item = cJSON_GetObjectItem(obj, "rate")))
        meta.rate = static_cast<float>(item->valuedouble);
    if ((s = json_str(cJSON_GetObjectItem(obj, "access"))))
        meta.access = parse_access(s);
    // ground: seconds back to init when no longer fed; one number for both
    // directions, [up, down] for two; null or absent: the value stays
    if ((item = cJSON_GetObjectItem(obj, "ground"))) {
        if (cJSON_IsNumber(item)) {
            meta.ground_up = meta.ground_down = static_cast<float>(item->valuedouble);
        } else if (cJSON_IsArray(item) && cJSON_GetArraySize(item) >= 1) {
            meta.ground_up = static_cast<float>(cJSON_GetArrayItem(item, 0)->valuedouble);
            meta.ground_down = cJSON_GetArraySize(item) >= 2
                ? static_cast<float>(cJSON_GetArrayItem(item, 1)->valuedouble) : meta.ground_up;
        }
    }
    if ((item = cJSON_GetObjectItem(obj, "hardware")))
        meta.hardware = json_bool(item);
    if ((item = cJSON_GetObjectItem(obj, "slots")) && cJSON_IsNumber(item))
        meta.slots = static_cast<uint8_t>(std::min(255, std::max(0, item->valueint)));
    if ((s = json_str(cJSON_GetObjectItem(obj, "role"))))
        meta.role = parse_role(s);
    if ((s = json_str(cJSON_GetObjectItem(obj, "full"))))
        meta.full = parse_full(s);
    if ((s = json_str(cJSON_GetObjectItem(obj, "ids"))))
        meta.ids = parse_ids(s);
    // merge (9.3): how a destination combines several links: "ltp" (the
    // default), "htp", "avg"
    if ((s = json_str(cJSON_GetObjectItem(obj, "merge"))))
        meta.merge = parse_merge(s);
    if ((s = json_str(cJSON_GetObjectItem(obj, "samples"))))
        meta.every = std::strcmp(s, "every") == 0;
    if ((item = cJSON_GetObjectItem(obj, "grace")) && cJSON_IsNumber(item))
        meta.grace_ms = static_cast<uint16_t>(std::min(65535, std::max(0, item->valueint)));
    // "release": "held" keeps a released instance's slot for its resonance,
    // "hold" seconds (10 by default; 0: until the host closes it)
    if ((s = json_str(cJSON_GetObjectItem(obj, "release"))) && std::strcmp(s, "held") == 0) {
        meta.hold = 10.0f;
        if ((item = cJSON_GetObjectItem(obj, "hold")) && cJSON_IsNumber(item))
            meta.hold = static_cast<float>(std::max(0.0, item->valuedouble));
    }
    if ((s = json_str(cJSON_GetObjectItem(obj, "unit"))))
        meta.unit = s;
    if ((s = json_str(cJSON_GetObjectItem(obj, "nature"))))
        meta.nature = parse_nature(s);
    if ((s = json_str(cJSON_GetObjectItem(obj, "topology"))))
        meta.topology = parse_topology(s);

    // Range (an array's: one element's, the same for all)
    cJSON* range = cJSON_GetObjectItem(obj, "range");
    if (range) {
        const ParamType rt = meta.type == ParamType::Array ? elem_scalar(meta.of) : meta.type;
        cJSON* min_v = cJSON_GetObjectItem(range, "min");
        cJSON* max_v = cJSON_GetObjectItem(range, "max");
        cJSON* init_v = cJSON_GetObjectItem(range, "init");
        if (min_v)  meta.range_min  = parse_value(min_v, rt);
        if (max_v)  meta.range_max  = parse_value(max_v, rt);
        if (init_v) meta.range_init = parse_value(init_v, rt);
    }
}

// Recursively parse params/groups from a JSON "children" array. refused(path,
// meta): a param that wasn't declared.
template <typename Refused>
static void parse_children(cJSON* children, ParamStore& store, const char* parent_path, Refused&& refused) {
    int count = json_count(children);
    for (int i = 0; i < count; ++i) {
        cJSON* child = json_at(children, i);
        if (!child) continue;

        ParamMeta meta;
        parse_meta(child, meta);

        cJSON* kind_item = cJSON_GetObjectItem(child, "kind");
        const char* kind_str = json_str(kind_item);
        if (!kind_str) kind_str = "param";

        // Build full path using name (the tree key). Label is display only.
        cJSON* name_item = cJSON_GetObjectItem(child, "name");
        const char* name = json_str(name_item);
        if (!name) name = meta.label.empty() ? "unnamed" : meta.label.c_str();
        meta.name = name;

        Text path;                                 // whole: a name of any length
        if (!path_join(parent_path, name, path)) continue;   // out of memory

        if (strcmp(kind_str, "class") == 0) {
            meta.kind = ParamKind::Class;
            store.define_class(name, meta);
        } else if (strcmp(kind_str, "poly") == 0) {
            // A population: "children" is one slot's template, declared
            // `slots` times as the groups 1 … N. On the mesh it is a group
            // that says how many slots it has (see ParamMetaCore::slots).
            meta.kind = ParamKind::Group;
            if (meta.slots == 0) meta.slots = 1;
            store.declare_group(path.c_str(), meta);
            cJSON* sub = cJSON_GetObjectItem(child, "children");
            for (int n = 1; n <= meta.slots; ++n) {
                char number[8];
                snprintf(number, sizeof(number), "%d", n);
                Text slot_path;
                if (!path_join(path.c_str(), number, slot_path)) continue;
                ParamMeta slot;
                slot.kind = ParamKind::Group;
                slot.name = number;
                slot.label = number;
                store.declare_group(slot_path.c_str(), slot);
                parse_children(sub, store, slot_path.c_str(), refused);
            }
        } else if (strcmp(kind_str, "group") == 0) {
            meta.kind = ParamKind::Group;
            store.declare_group(path.c_str(), meta);
            // Recurse into children
            cJSON* sub = cJSON_GetObjectItem(child, "children");
            parse_children(sub, store, path.c_str(), refused);
        } else {
            meta.kind = ParamKind::Param;
            const bool had = store.resolve(path.c_str()) != nullptr;
            auto* p = store.declare_param(path.c_str(), meta);
            if (!p) refused(path.c_str(), meta);
            // Its value, as saved ("value": dataflou-node keeps there what
            // the visualizer sets on a param without a range, and an
            // array's values, its init being one element's; 9.3): where the
            // param starts, past its init. A param declared again keeps the
            // value it has (a hot re-declare); a trigger has none.
            cJSON* value = cJSON_GetObjectItem(child, "value");
            if (p && !had && value && !cJSON_IsNull(value) && value_fits(value, p->meta.type))
                p->value = value_from_json(value, p->meta);
        }
    }
}

// --- Public API ---

expected<void, Error> Node::load_json(const char* json_string) {
    cJSON* root = cJSON_Parse(json_string);
    if (!root) return unexpected<Error>(Error::ParseFailed);

    // Parse identity
    cJSON* id = cJSON_GetObjectItem(root, "identity");
    if (id) {
        cJSON* item;
        const char* s;
        if ((s = json_str(cJSON_GetObjectItem(id, "sku"))))
            identity_.sku = s;
        if ((s = json_str(cJSON_GetObjectItem(id, "label"))))
            identity_.label = s;
        if ((s = json_str(cJSON_GetObjectItem(id, "product"))))
            identity_.product = s;
        if ((item = cJSON_GetObjectItem(id, "version")))
            identity_.version = static_cast<uint32_t>(item->valueint);
        if ((s = json_str(cJSON_GetObjectItem(id, "state"))))
            identity_.state = parse_node_state(s);
    }

    // Parse optional universe
    cJSON* univ = cJSON_GetObjectItem(root, "universe");
    if (univ && cJSON_IsString(univ)) {
        universe_.assign(univ->valuestring,
                         std::min(std::strlen(univ->valuestring),
                                  static_cast<size_t>(universe_.max_size())));
    }

    // Seeds: nodes to dial by address ("host:port"), where mDNS doesn't reach
    cJSON* seeds = cJSON_GetObjectItem(root, "seeds");
    for (int i = 0; i < json_count(seeds); ++i) {
        const char* s = json_str(json_at(seeds, i));
        const char* colon = s ? std::strrchr(s, ':') : nullptr;
        if (!colon || colon == s) continue;
        etl::string<64> host(s, std::min(static_cast<size_t>(colon - s), static_cast<size_t>(63)));
        const long port = std::strtol(colon + 1, nullptr, 10);
        if (port > 0 && port <= 0xFFFF) add_seed(host.c_str(), static_cast<uint16_t>(port));
    }

    // Parse optional role: "source" publishes only, "satellite" keeps little of
    // the world (see NodeRole)
    cJSON* role = cJSON_GetObjectItem(root, "role");
    if (role && cJSON_IsString(role))
        set_role(parse_node_role(role->valuestring));

    // Parse classes first
    cJSON* classes = cJSON_GetObjectItem(root, "classes");
    int class_count = json_count(classes);
    for (int i = 0; i < class_count; ++i) {
        cJSON* cls = json_at(classes, i);
        ParamMeta meta;
        parse_meta(cls, meta);
        meta.kind = ParamKind::Class;
        if (const char* name = json_str(cJSON_GetObjectItem(cls, "name"))) {
            local_params_.define_class(name, meta);
        }
    }

    // Parse params tree
    cJSON* params = cJSON_GetObjectItem(root, "params");
    parse_children(params, local_params_, "", [this](const char* path, const ParamMeta& meta) {
        refused_declaration(path, &meta);
    });

    // Hot re-declare when already running
    if (running_) redeclare();

    cJSON_Delete(root);
    return {};
}

expected<void, Error> Node::load_json_file(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) return unexpected<Error>(Error::NotFound);

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (size <= 0 || size > 1024 * 1024) {
        fclose(f);
        return unexpected<Error>(Error::ParseFailed);
    }

    char* buf = new char[static_cast<size_t>(size) + 1];
    size_t read = fread(buf, 1, static_cast<size_t>(size), f);
    fclose(f);

    buf[read] = '\0';
    auto result = load_json(buf);
    delete[] buf;
    return result;
}

} // namespace dataflou
