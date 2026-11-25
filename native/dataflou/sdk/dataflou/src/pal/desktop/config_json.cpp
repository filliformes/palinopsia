#include "desktop/config_json.h"
#include "dataflou/array.h"
#include <cJSON.h>
#include <cstring>

namespace dataflou {

static bool value_equal(const ParamValueCore& a, const ParamValueCore& b, ParamType type) {
    using enum ParamType;
    switch (type) {
    case Bool:   return a.b == b.b;
    case Number: return a.n == b.n;
    case V2:     return std::memcmp(a.v2, b.v2, sizeof(a.v2)) == 0;
    case V3:     return std::memcmp(a.v3, b.v3, sizeof(a.v3)) == 0;
    case V4:     return std::memcmp(a.v4, b.v4, sizeof(a.v4)) == 0;
    case Colour: return std::memcmp(a.rgba, b.rgba, sizeof(a.rgba)) == 0;
    case String:
    case Blob:
    case Trigger:
    case Array: return true; // no range for these types (an array's is its elements')
    }
    return true;
}

static cJSON* value_to_json(const ParamValueCore& v, ParamType type) {
    using enum ParamType;
    switch (type) {
    case Bool:   return cJSON_CreateBool(v.b);
    case Number: return cJSON_CreateNumber(v.n);
    case V2:
    case V3:
    case V4: {
        const int n = type == V2 ? 2 : type == V3 ? 3 : 4;
        cJSON* arr = cJSON_CreateArray();
        for (int i = 0; i < n; ++i)
            cJSON_AddItemToArray(arr, cJSON_CreateNumber(v.v4[i]));
        return arr;
    }
    case Colour: {
        cJSON* arr = cJSON_CreateArray();
        for (int i = 0; i < 4; ++i)
            cJSON_AddItemToArray(arr, cJSON_CreateNumber(v.rgba[i]));
        return arr;
    }
    case String:
    case Blob:
    case Trigger:
    case Array: break;
    }
    return cJSON_CreateNull();
}

template <size_t N>
static void add_str(cJSON* obj, const char* key, const etl::string<N>& s,
                    const etl::string<N>& base) {
    if (s != base) cJSON_AddStringToObject(obj, key, s.c_str());
}

static void add_str(cJSON* obj, const char* key, const Text& s, const Text& base) {
    if (s != base) cJSON_AddStringToObject(obj, key, s.c_str());
}

// Emit metadata fields that differ from `base`. Class-inherited fields (see
// ParamStoreT::apply_class_defaults) compare against `cls`; the rest against
// defaults, since the loader never takes them from a class.
static void add_meta(cJSON* obj, const ParamMeta& m, const ParamMeta& cls) {
    const ParamMeta def;

    add_str(obj, "uuid", m.uuid, def.uuid);
    add_str(obj, "label", m.label, def.label);
    add_str(obj, "desc", m.desc, def.desc);
    add_str(obj, "gui", m.gui_hint, def.gui_hint);
    add_str(obj, "inherits", m.inherits, def.inherits);

    if (m.type != cls.type)     cJSON_AddStringToObject(obj, "type", to_string(m.type));
    if (m.type == ParamType::Array && (m.of != cls.of || m.size != cls.size || m.type != cls.type)) {
        cJSON_AddStringToObject(obj, "of", to_string(m.of));      // 9.3
        cJSON_AddNumberToObject(obj, "size", m.size);
    }
    if (m.mode != cls.mode)     cJSON_AddStringToObject(obj, "mode", to_string(m.mode));
    if (m.flow != cls.flow)     cJSON_AddStringToObject(obj, "flow", to_string(m.flow));
    if (m.access != cls.access) cJSON_AddStringToObject(obj, "access", to_string(m.access));
    if (m.rate != cls.rate)     cJSON_AddNumberToObject(obj, "rate", m.rate);
    if (m.ground_up != cls.ground_up || m.ground_down != cls.ground_down) {
        if (!m.grounds())
            cJSON_AddNullToObject(obj, "ground");
        else if (m.ground_up == m.ground_down)
            cJSON_AddNumberToObject(obj, "ground", m.ground_up);
        else {
            cJSON* g = cJSON_AddArrayToObject(obj, "ground");
            cJSON_AddItemToArray(g, cJSON_CreateNumber(m.ground_up));
            cJSON_AddItemToArray(g, cJSON_CreateNumber(m.ground_down));
        }
    }
    if (m.hardware != cls.hardware) cJSON_AddBoolToObject(obj, "hardware", m.hardware);
    if (m.role != cls.role) cJSON_AddStringToObject(obj, "role", to_string(m.role));
    if (m.every != cls.every) cJSON_AddStringToObject(obj, "samples", m.every ? "every" : "last");
    if (m.merge != cls.merge) cJSON_AddStringToObject(obj, "merge", to_string(m.merge));
    add_str(obj, "unit", m.unit, cls.unit);
    if (m.nature != cls.nature) cJSON_AddStringToObject(obj, "nature", to_string(m.nature));
    if (m.topology != cls.topology) cJSON_AddStringToObject(obj, "topology", to_string(m.topology));

    // The range comes from the class when the param declares none and the
    // types match (apply_class_defaults), so compare against the class then.
    // An array's range is one element's (9.3)
    const ParamType rt = m.type == ParamType::Array ? elem_scalar(m.of) : m.type;
    const ParamMeta& rbase = (m.type == cls.type) ? cls : def;
    const bool min_set  = !value_equal(m.range_min,  rbase.range_min,  rt);
    const bool max_set  = !value_equal(m.range_max,  rbase.range_max,  rt);
    const bool init_set = !value_equal(m.range_init, rbase.range_init, rt);
    if (min_set || max_set || init_set) {
        cJSON* range = cJSON_AddObjectToObject(obj, "range");
        cJSON_AddItemToObject(range, "min",  value_to_json(m.range_min,  rt));
        cJSON_AddItemToObject(range, "max",  value_to_json(m.range_max,  rt));
        cJSON_AddItemToObject(range, "init", value_to_json(m.range_init, rt));
    }
}

static cJSON* node_to_json(const ParamNode* node, const ParamStore& store) {
    cJSON* obj = cJSON_CreateObject();
    cJSON_AddStringToObject(obj, "name", node->meta.name.c_str());

    if (node->meta.kind == ParamKind::Group && node->meta.slots > 0 && !node->children.empty()) {
        // A poly group goes back as it is written: its slot count and one
        // slot's content (the first: they are all alike).
        cJSON_AddStringToObject(obj, "kind", "poly");
        cJSON_AddNumberToObject(obj, "slots", node->meta.slots);
        if (node->meta.full != FullPolicy::Steal) cJSON_AddStringToObject(obj, "full", to_string(node->meta.full));
        if (node->meta.ids != IdsMode::Auto) cJSON_AddStringToObject(obj, "ids", to_string(node->meta.ids));
        if (node->meta.grace_ms > 0) cJSON_AddNumberToObject(obj, "grace", node->meta.grace_ms);
        if (node->meta.hold >= 0.0f) {
            cJSON_AddStringToObject(obj, "release", "held");
            cJSON_AddNumberToObject(obj, "hold", node->meta.hold);
        }
        const ParamMeta def;
        add_str(obj, "label", node->meta.label, def.label);
        add_str(obj, "desc", node->meta.desc, def.desc);
        cJSON* children = cJSON_AddArrayToObject(obj, "children");
        for (const auto* child : node->children[0]->children)
            cJSON_AddItemToArray(children, node_to_json(child, store));
        return obj;
    }

    if (node->meta.kind == ParamKind::Group) {
        cJSON_AddStringToObject(obj, "kind", "group");
        const ParamMeta def;
        add_str(obj, "label", node->meta.label, def.label);
        add_str(obj, "desc", node->meta.desc, def.desc);
        cJSON* children = cJSON_AddArrayToObject(obj, "children");
        for (const auto* child : node->children)
            cJSON_AddItemToArray(children, node_to_json(child, store));
        return obj;
    }

    cJSON_AddStringToObject(obj, "kind", "param");
    const ParamMeta* cls = node->meta.inherits.empty()
        ? nullptr : store.find_class(node->meta.inherits.c_str());
    add_meta(obj, node->meta, cls ? *cls : ParamMeta{});
    return obj;
}

char* config_to_json(const Node& node, bool pretty) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "universe", node.universe().c_str());
    if (node.role() != NodeRole::Full) cJSON_AddStringToObject(root, "role", to_string(node.role()));

    const auto& id = node.identity();
    cJSON* ident = cJSON_AddObjectToObject(root, "identity");
    cJSON_AddStringToObject(ident, "sku", id.sku.c_str());
    cJSON_AddStringToObject(ident, "label", id.label.c_str());
    cJSON_AddStringToObject(ident, "product", id.product.c_str());
    cJSON_AddNumberToObject(ident, "version", id.version);
    cJSON_AddStringToObject(ident, "state", to_string(id.state));

    const auto& store = node.local_params();
    cJSON* classes = cJSON_AddArrayToObject(root, "classes");
    for (size_t i = 0; i < store.class_count(); ++i) {
        cJSON* cls = cJSON_CreateObject();
        cJSON_AddStringToObject(cls, "name", store.class_name(i));
        add_meta(cls, store.class_meta(i), ParamMeta{});
        cJSON_AddItemToArray(classes, cls);
    }

    cJSON* params = cJSON_AddArrayToObject(root, "params");
    for (const auto* child : store.root()->children)
        cJSON_AddItemToArray(params, node_to_json(child, store));

    char* str = pretty ? cJSON_Print(root) : cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return str;
}

static void collect_paths(const cJSON* children, const std::string& prefix,
                          std::vector<std::string>& out) {
    // Same leniency as config_loader: a lone object counts as a one-item array.
    const int count = cJSON_IsArray(children) ? cJSON_GetArraySize(children)
                    : cJSON_IsObject(children) ? 1 : 0;
    for (int i = 0; i < count; ++i) {
        const cJSON* child = cJSON_IsArray(children)
            ? cJSON_GetArrayItem(children, i) : children;
        const cJSON* kind = cJSON_GetObjectItem(child, "kind");
        if (cJSON_IsString(kind) && std::strcmp(kind->valuestring, "class") == 0)
            continue;
        const cJSON* name = cJSON_GetObjectItem(child, "name");
        if (!cJSON_IsString(name)) continue;

        std::string path = prefix.empty() ? name->valuestring
                                          : prefix + "/" + name->valuestring;
        out.push_back(path);
        collect_paths(cJSON_GetObjectItem(child, "children"), path, out);
    }
}

bool config_paths(const char* json, std::vector<std::string>& out) {
    cJSON* root = cJSON_Parse(json);
    if (!root) return false;
    collect_paths(cJSON_GetObjectItem(root, "params"), "", out);
    cJSON_Delete(root);
    return true;
}

// Max dictionaries have no boolean type; compare true/false as 1/0.
static void bools_to_numbers(cJSON* item) {
    for (cJSON* child = item ? item->child : nullptr; child; child = child->next) {
        if (cJSON_IsBool(child)) {
            const double v = cJSON_IsTrue(child) ? 1 : 0;
            child->type = cJSON_Number;
            cJSON_SetNumberValue(child, v);
        }
        bools_to_numbers(child);
    }
}

bool config_equal(const char* a, const char* b) {
    cJSON* ja = cJSON_Parse(a);
    cJSON* jb = cJSON_Parse(b);
    bool equal = false;
    if (ja && jb) {
        bools_to_numbers(ja);
        bools_to_numbers(jb);
        equal = cJSON_Compare(ja, jb, true);
    }
    cJSON_Delete(ja);
    cJSON_Delete(jb);
    return equal;
}

static void current_paths(const ParamNode* node, const std::string& prefix,
                          std::vector<std::string>& out) {
    for (const auto* child : node->children) {
        std::string path = prefix.empty() ? child->meta.name.c_str()
                                          : prefix + "/" + child->meta.name.c_str();
        out.push_back(path);
        current_paths(child, path, out);
    }
}

bool apply_config(Node& node, const char* json, std::string& error) {
    cJSON* root = cJSON_Parse(json);
    if (!root) {
        error = "config is not valid JSON";
        return false;
    }

    const cJSON* sku = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "identity"), "sku");
    const cJSON* univ = cJSON_GetObjectItem(root, "universe");
    if (cJSON_IsString(sku) && node.identity().sku != sku->valuestring) {
        error = "identity.sku changed; restart the node to apply";
    } else if (cJSON_IsString(univ) && node.universe() != univ->valuestring) {
        error = "universe changed; use /_df/universe or restart the node";
    }

    std::vector<std::string> wanted;
    collect_paths(cJSON_GetObjectItem(root, "params"), "", wanted);
    cJSON_Delete(root);
    if (!error.empty()) return false;

    // Remove what the new config no longer declares. Paths are in tree order,
    // so a removed group's children simply fail to resolve afterwards.
    std::vector<std::string> existing;
    current_paths(node.local_params().root(), "", existing);
    for (const auto& path : existing) {
        bool keep = false;
        for (const auto& w : wanted) {
            if (w == path) { keep = true; break; }
        }
        if (!keep) node.remove_param(path.c_str());
    }

    if (!node.load_json(json)) {
        error = "config could not be loaded";
        return false;
    }
    return true;
}

} // namespace dataflou
