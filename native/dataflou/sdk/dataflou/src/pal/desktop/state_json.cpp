#include "desktop/state_json.h"
#include "desktop/config_json.h"
#include "desktop/world_json.h"
#include "dataflou/version.h"
#include <cJSON.h>
#include <cstring>

namespace dataflou {

static constexpr int STATE_FORMAT = 1;

// --- base64 (RFC 4648, with padding) ---

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string to_base64(const std::vector<uint8_t>& in) {
    std::string out;
    out.reserve((in.size() + 2) / 3 * 4);
    for (size_t i = 0; i < in.size(); i += 3) {
        const uint32_t n = (uint32_t(in[i]) << 16) |
                           (i + 1 < in.size() ? uint32_t(in[i + 1]) << 8 : 0) |
                           (i + 2 < in.size() ? uint32_t(in[i + 2]) : 0);
        out += B64[(n >> 18) & 63];
        out += B64[(n >> 12) & 63];
        out += i + 1 < in.size() ? B64[(n >> 6) & 63] : '=';
        out += i + 2 < in.size() ? B64[n & 63] : '=';
    }
    return out;
}

static bool from_base64(const char* in, std::vector<uint8_t>& out) {
    out.clear();
    uint32_t acc = 0;
    int bits = 0;
    for (const char* p = in; *p; ++p) {
        if (*p == '=') break;
        const char* at = std::strchr(B64, *p);
        if (!at || !*at) return false;
        acc = (acc << 6) | uint32_t(at - B64);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<uint8_t>(acc >> bits));
        }
    }
    return true;
}

// A storage record whole, whatever its size (the storage reads at most the
// buffer it is given)
static bool read_record(IStorage& storage, const char* key, std::vector<uint8_t>& out) {
    for (size_t room = 256; room <= (64u << 20); room *= 4) {
        out.resize(room);
        size_t len = 0;
        if (!storage.read(key, etl::span<uint8_t>(out.data(), out.size()), len)) return false;
        if (len < room) {
            out.resize(len);
            return true;
        }
    }
    return false;
}

// What a host sets by hand and would want back: readable params, outside
// populations (an instance's values are its own), triggers left out
static void collect_values(const ParamNode* n, const std::string& path, cJSON* values) {
    for (const ParamNode* c : n->children) {
        const std::string p = path.empty() ? c->meta.name.c_str() : path + "/" + c->meta.name.c_str();
        if (c->meta.kind == ParamKind::Param) {
            if (readable(c->meta.access) && c->meta.type != ParamType::Trigger && !c->value.unknown)
                cJSON_AddItemToObject(values, p.c_str(), param_value_to_json(c->value));
        } else if (c->meta.slots == 0) {
            collect_values(c, p, values);
        }
    }
}

char* state_to_json(Node& node, IStorage& storage, bool pretty) {
    node.save_state();
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "dataflou_state", STATE_FORMAT);
    cJSON_AddStringToObject(root, "core", DATAFLOU_VERSION);

    const NodeIdentity& id = node.identity();
    cJSON* ident = cJSON_AddObjectToObject(root, "identity");
    cJSON_AddStringToObject(ident, "sku", id.sku.c_str());
    cJSON_AddStringToObject(ident, "label", id.label.c_str());
    cJSON_AddStringToObject(ident, "product", id.product.c_str());
    cJSON_AddStringToObject(root, "universe", node.universe().c_str());

    if (char* config = config_to_json(node, false)) {
        if (cJSON* c = cJSON_Parse(config)) cJSON_AddItemToObject(root, "config", c);
        json_free(config);
    }

    cJSON* records = cJSON_AddObjectToObject(root, "records");
    etl::string<16> key;
    std::vector<uint8_t> data;
    for (size_t i = 0; Node::state_key(i, key); ++i)
        if (read_record(storage, key.c_str(), data))
            cJSON_AddStringToObject(records, key.c_str(), to_base64(data).c_str());

    cJSON* values = cJSON_AddObjectToObject(root, "values");
    collect_values(node.local_params().root(), "", values);

    char* out = pretty ? cJSON_Print(root) : cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return out;
}

bool state_from_json(const char* json, ExportedState& out, std::string& error) {
    out = ExportedState{};
    cJSON* root = json ? cJSON_Parse(json) : nullptr;
    if (!root) {
        error = "not JSON";
        return false;
    }
    const cJSON* format = cJSON_GetObjectItem(root, "dataflou_state");
    if (!cJSON_IsNumber(format)) {
        error = "not a dataflou state (no \"dataflou_state\")";
    } else if (format->valueint > STATE_FORMAT) {
        error = "a state of format " + std::to_string(format->valueint) + ", newer than this one reads (" +
                std::to_string(STATE_FORMAT) + ")";
    }
    const cJSON* ident = cJSON_GetObjectItem(root, "identity");
    const cJSON* sku = ident ? cJSON_GetObjectItem(ident, "sku") : nullptr;
    if (error.empty() && (!cJSON_IsString(sku) || std::strlen(sku->valuestring) != 36))
        error = "no sku in its identity";
    if (!error.empty()) {
        cJSON_Delete(root);
        return false;
    }
    out.identity.sku = sku->valuestring;
    if (const cJSON* l = cJSON_GetObjectItem(ident, "label"); cJSON_IsString(l)) out.identity.label = l->valuestring;
    if (const cJSON* p = cJSON_GetObjectItem(ident, "product"); cJSON_IsString(p)) out.identity.product = p->valuestring;
    if (const cJSON* u = cJSON_GetObjectItem(root, "universe"); cJSON_IsString(u)) out.universe = u->valuestring;
    if (const cJSON* c = cJSON_GetObjectItem(root, "config"); cJSON_IsObject(c)) {
        char* text = cJSON_PrintUnformatted(c);
        out.config = text ? text : "";
        cJSON_free(text);
    }

    // Only the keys the core keeps its state under: a document can't write
    // anything else into a node's storage
    const cJSON* records = cJSON_GetObjectItem(root, "records");
    etl::string<16> key;
    for (size_t i = 0; Node::state_key(i, key); ++i) {
        const cJSON* r = records ? cJSON_GetObjectItem(records, key.c_str()) : nullptr;
        if (!r) continue;
        std::vector<uint8_t> data;
        if (!cJSON_IsString(r) || !from_base64(r->valuestring, data)) {
            error = std::string("record ") + key.c_str() + " is not base64";
            cJSON_Delete(root);
            return false;
        }
        out.records.emplace_back(key.c_str(), std::move(data));
    }

    if (const cJSON* values = cJSON_GetObjectItem(root, "values"); cJSON_IsObject(values)) {
        for (const cJSON* v = values->child; v; v = v->next) {
            char* text = cJSON_PrintUnformatted(v);
            if (text) out.values.emplace_back(v->string, text);
            cJSON_free(text);
        }
    }
    cJSON_Delete(root);
    return true;
}

bool state_write_records(const ExportedState& state, IStorage& storage) {
    bool ok = true;
    for (const auto& r : state.records)
        ok = storage.write(r.first.c_str(), etl::span<const uint8_t>(r.second.data(), r.second.size())) && ok;
    return ok;
}

// A param's entry in a config's "params", by its path ("a/b/c")
static cJSON* config_param(cJSON* config, const std::string& path) {
    cJSON* list = cJSON_GetObjectItem(config, "params");
    cJSON* found = nullptr;
    size_t from = 0;
    while (list && from <= path.size()) {
        const size_t slash = path.find('/', from);
        const std::string name = path.substr(from, slash == std::string::npos ? std::string::npos : slash - from);
        found = nullptr;
        cJSON* c = nullptr;
        cJSON_ArrayForEach(c, list) {
            const cJSON* n = cJSON_GetObjectItem(c, "name");
            const cJSON* k = cJSON_GetObjectItem(c, "kind");
            if (cJSON_IsString(n) && name == n->valuestring &&
                !(cJSON_IsString(k) && std::strcmp(k->valuestring, "class") == 0)) { found = c; break; }
        }
        if (!found || slash == std::string::npos) return found;
        list = cJSON_GetObjectItem(found, "children");
        from = slash + 1;
    }
    return nullptr;
}

std::string state_config_with_values(const ExportedState& state) {
    if (state.config.empty()) return "";
    cJSON* config = cJSON_Parse(state.config.c_str());
    if (!config) return state.config;
    for (const auto& [path, text] : state.values) {
        cJSON* p = config_param(config, path);
        cJSON* v = p ? cJSON_Parse(text.c_str()) : nullptr;
        if (!v) continue;
        if (cJSON_GetObjectItem(p, "value")) cJSON_ReplaceItemInObject(p, "value", v);
        else cJSON_AddItemToObject(p, "value", v);
    }
    char* out = cJSON_PrintUnformatted(config);
    cJSON_Delete(config);
    std::string s = out ? out : state.config;
    cJSON_free(out);
    return s;
}

size_t state_apply_values(Node& node, const ExportedState& state, const char* only_path) {
    size_t set = 0;
    for (const auto& [path, text] : state.values) {
        if (only_path && path != only_path) continue;
        const ParamNode* p = node.local_params().resolve(path.c_str());
        if (!p || p->meta.kind != ParamKind::Param || !readable(p->meta.access) ||
            p->meta.type == ParamType::Trigger) continue;
        cJSON* item = cJSON_Parse(text.c_str());
        if (!item) continue;
        if (!cJSON_IsNull(item)) {
            node.set_value(path.c_str(), value_from_json(item, p->meta));
            ++set;
        }
        cJSON_Delete(item);
    }
    return set;
}

} // namespace dataflou
