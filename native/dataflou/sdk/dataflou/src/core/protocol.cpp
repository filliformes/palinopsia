// protocol.cpp — CBOR encode/decode for the dataflou topology protocol.
// Uses QCBOR v1.6 (zero-alloc CBOR codec).
// Compile with: -std=c++17 -fno-rtti -fno-exceptions

#include "dataflou/protocol.h"
#include "dataflou/param.h"
#include "dataflou/array.h"
#include "stream_codec.h"

#include <qcbor/qcbor_encode.h>
#include <qcbor/qcbor_decode.h>
#include <qcbor/qcbor_spiffy_decode.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <etl/span.h>

namespace dataflou {

// ---------------------------------------------------------------------------
// String conversion helpers — encode uses to_string() from types.h.
// Decode adapters: extract C-string from UsefulBufC, delegate to types.h.
// ---------------------------------------------------------------------------

static bool str_eq(const UsefulBufC& buf, const char* s) {
    size_t slen = strlen(s);
    if (buf.len != slen) return false;
    return memcmp(buf.ptr, s, slen) == 0;
}

static const char* ubufc_tmp(const UsefulBufC& buf, char* tmp, size_t n) {
    size_t len = buf.len < n - 1 ? buf.len : n - 1;
    memcpy(tmp, buf.ptr, len);
    tmp[len] = '\0';
    return tmp;
}

static NodeState parse_node_state(const UsefulBufC& s) {
    char tmp[32]; return parse_node_state(ubufc_tmp(s, tmp, sizeof(tmp)));
}

// ---------------------------------------------------------------------------
// UsefulBufC <-> etl::string helpers
// ---------------------------------------------------------------------------

template <size_t N>
static void ubufc_to_etlstr(const UsefulBufC& buf, etl::string<N>& out) {
    if (!buf.ptr) {   // not read: empty, never a copy from nowhere
        out.clear();
        return;
    }
    size_t copy_len = buf.len < N ? buf.len : N;
    out.assign(static_cast<const char*>(buf.ptr), copy_len);
}

static void ubufc_to_etlstr(const UsefulBufC& buf, Text& out) {
    if (!buf.ptr) { out.clear(); return; }
    out.assign(static_cast<const char*>(buf.ptr), buf.len);
}

template <size_t N>
static UsefulBufC etlstr_to_ubufc(const etl::string<N>& s) {
    UsefulBufC result;
    result.ptr = s.data();
    result.len = s.size();
    return result;
}

// ---------------------------------------------------------------------------
// Skus (9.1): a node's sku is a UUID, and travels as its 16 bytes; a sku
// that isn't one in its usual form (lowercase 8-4-4-4-12) travels as text,
// as it is, so it comes back the same. Both are read.
// ---------------------------------------------------------------------------

static bool sku_to_bytes(const char* s, uint8_t out[16]) {
    if (!s) return false;
    int n = 0;
    for (int i = 0; i < 36; ++i) {          // stops at the end of a shorter one
        const char c = s[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
            continue;
        }
        const int v = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : -1;
        if (v < 0) return false;
        if (n & 1) out[n / 2] = static_cast<uint8_t>(out[n / 2] | v);
        else       out[n / 2] = static_cast<uint8_t>(v << 4);
        ++n;
    }
    return s[36] == '\0';
}

static void sku_from(uint8_t type, const UsefulBufC& v, etl::string<36>& out) {
    out.clear();
    if (type == QCBOR_TYPE_BYTE_STRING && v.ptr && v.len == 16) {
        static const char hex[] = "0123456789abcdef";
        const uint8_t* b = static_cast<const uint8_t*>(v.ptr);
        char t[36];
        int j = 0;
        for (int i = 0; i < 16; ++i) {
            if (i == 4 || i == 6 || i == 8 || i == 10) t[j++] = '-';
            t[j++] = hex[b[i] >> 4];
            t[j++] = hex[b[i] & 15];
        }
        out.assign(t, 36);
    } else if (type == QCBOR_TYPE_TEXT_STRING) {
        ubufc_to_etlstr(v, out);
    }
}

static void add_sku_to_map(QCBOREncodeContext* ctx, const char* key, const char* sku) {
    uint8_t b[16];
    if (sku_to_bytes(sku, b)) QCBOREncode_AddBytesToMapSZ(ctx, key, UsefulBufC{b, 16});
    else                      QCBOREncode_AddSZStringToMapSZ(ctx, key, sku);
}

// Like the other getters: missing, or of another type, it is empty and the
// decoder's error says so
static void get_sku_in_map(QCBORDecodeContext* ctx, const char* key, etl::string<36>& out) {
    QCBORItem item;
    QCBORDecode_GetItemInMapSZ(ctx, key, QCBOR_TYPE_ANY, &item);
    out.clear();
    if (QCBORDecode_GetError(ctx) != QCBOR_SUCCESS) return;
    if (item.uDataType != QCBOR_TYPE_BYTE_STRING && item.uDataType != QCBOR_TYPE_TEXT_STRING) return;
    sku_from(item.uDataType, item.val.string, out);
}

// ---------------------------------------------------------------------------
// Encode helpers
// ---------------------------------------------------------------------------

// Encode common header fields: "msg", "seq" (who sends is said once, in
// HELLO: after it, a connection's messages are from who its HELLO said, 9.1)
static void encode_header(QCBOREncodeContext* ctx,
                          const char* msg_name,
                          uint32_t seq) {
    QCBOREncode_AddSZStringToMapSZ(ctx, "msg", msg_name);
    QCBOREncode_AddUInt64ToMapSZ(ctx, "seq", seq);
}

// Encode a NodeIdentity as a nested map under key "identity"
static void encode_identity(QCBOREncodeContext* ctx, const NodeIdentity& id) {
    QCBOREncode_OpenMapInMapSZ(ctx, "identity");
    add_sku_to_map(ctx, "sku", id.sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(ctx, "label", id.label.c_str());
    QCBOREncode_AddSZStringToMapSZ(ctx, "product", id.product.c_str());
    QCBOREncode_AddUInt64ToMapSZ(ctx, "version", id.version);
    QCBOREncode_AddSZStringToMapSZ(ctx, "state", to_string(id.state));
    QCBOREncode_CloseMap(ctx);
}

// Encode a version vector as a nested map under `key` ("versions"; "cv"
// for connection lists, left out when empty)
static void encode_versions(QCBOREncodeContext* ctx,
                            const WorldView::VersionVector& versions,
                            const char* key = "versions") {
    if (versions.empty() && std::strcmp(key, "versions") != 0) return;
    QCBOREncode_OpenMapInMapSZ(ctx, key);
    for (auto it = versions.begin(); it != versions.end(); ++it) {
        uint8_t sku[16];   // a sku for the key: its bytes, as everywhere
        if (sku_to_bytes(it->first.c_str(), sku)) QCBOREncode_AddBytes(ctx, UsefulBufC{sku, 16});
        else                                      QCBOREncode_AddSZString(ctx, it->first.c_str());
        QCBOREncode_AddUInt64(ctx, it->second);
    }
    QCBOREncode_CloseMap(ctx);
}

// Finalize encoding: close map, finish, return bytes written or 0 on error.
static size_t finish_encode(QCBOREncodeContext* ctx) {
    QCBOREncode_CloseMap(ctx);

    UsefulBufC encoded;
    QCBORError err = QCBOREncode_Finish(ctx, &encoded);
    if (err != QCBOR_SUCCESS) {
        return 0;
    }
    return encoded.len;
}

// --- Integer CBOR keys for DECLARE param maps (compact protocol v2) ---
// Field | Key | Type
// path  |  1  | text
// kind  |  2  | uint8
// type  |  3  | uint8
// mode  |  4  | uint8
// flow  |  5  | uint8
// rate  |  6  | double
// access|  7  | uint8
// ground|  8  | bool
// hardware| 9 | bool
// range | 10  | map
// smooth| 11  | array
// unit  | 12  | text
// nature| 13  | uint8
// label | 14  | text
// desc  | 15  | text
// subs  | 16  | array
// topo  | 17  | uint8
// slots | 18  | uint8, only when not 0: a poly group's slot count (core 8.5)
// role  | 19  | uint8, only when not None: ParamRole, in a population's template (9.1)
// full  | 20  | uint8, only when not Steal: a population's policy when full (9.1)
// grace | 21  | uint, only when not 0: a population's grace for lost instances, ms (9.1)
// hold  | 22  | double, only when >= 0: a population's release held, s (0: by its host) (9.1)
// every | 23  | bool, only when true: every sample counts (9.1)
// ids   | 24  | uint8, only when not Auto: who gives a population's ids (9.1)
// of    | 25  | uint8, an array's only: its element type (ElemType) (9.3)
// size  | 26  | uint, an array's only: how many elements (9.3)
//
// An array (type 9, 9.3) says its element type and size; its range is one
// element's (a number, a bool, a colour). A 9.1 or 9.2 node takes it as a
// param of a type it doesn't know (to_string: "number"), which no value of
// reaches (stream entries of kind 9 are skipped, a STREAMREPLY of type 9
// ignored). A param of a type this node doesn't know is not declared.
//
// A poly group (9.0) goes out as a template: the group with its slot count,
// then slot "1" alone; the receiver makes slots 2 … N from it. Slots are
// alike, and a declaration carries no values or connections.

// Encode a ParamValueCore as a CBOR value using string key (ranges sub-map).
// Number → double, Bool → bool, V2/V3/V4 → array of doubles (one per
// component), Colour → array of 4 uints. Strings/blobs have no range.
static void encode_range_value(QCBOREncodeContext* ctx,
                               const char* key,
                               const ParamValueCore& val) {
    switch (val.tag) {
        case ParamType::Bool:
            QCBOREncode_AddBoolToMapSZ(ctx, key, val.b);
            break;
        case ParamType::Number:
            QCBOREncode_AddDoubleToMapSZ(ctx, key, val.n);
            break;
        case ParamType::V2:
            QCBOREncode_OpenArrayInMapSZ(ctx, key);
            for (int c = 0; c < 2; ++c) QCBOREncode_AddDouble(ctx, val.v2[c]);
            QCBOREncode_CloseArray(ctx);
            break;
        case ParamType::V3:
            QCBOREncode_OpenArrayInMapSZ(ctx, key);
            for (int c = 0; c < 3; ++c) QCBOREncode_AddDouble(ctx, val.v3[c]);
            QCBOREncode_CloseArray(ctx);
            break;
        case ParamType::V4:
            QCBOREncode_OpenArrayInMapSZ(ctx, key);
            for (int c = 0; c < 4; ++c) QCBOREncode_AddDouble(ctx, val.v4[c]);
            QCBOREncode_CloseArray(ctx);
            break;
        case ParamType::Colour:
            QCBOREncode_OpenArrayInMapSZ(ctx, key);
            for (int c = 0; c < 4; ++c) QCBOREncode_AddUInt64(ctx, val.rgba[c]);
            QCBOREncode_CloseArray(ctx);
            break;
        default:
            QCBOREncode_AddDoubleToMapSZ(ctx, key, 0.0);
            break;
    }
}

// Encode the params array from a ParamStore tree (recursive walk).
// Uses integer CBOR map keys and integer enum values (protocol v2).
// On embedded (DATAFLOU_SLIM_WORLDVIEW), omits label/desc/unit (terse DECLARE).
// `path` is one buffer for the whole walk: each node adds its name, and
// takes it off when done. No length limit: false only when out of memory
// (the DECLARE is then not sent, rather than sent with a path cut short).
template <typename NodeT>
static bool encode_param_node(QCBOREncodeContext* ctx,
                              const NodeT* node,
                              Vector<char>& path);

// Adds "/name" (or "name" at the root) to the path
static bool path_push(Vector<char>& path, const Text& name) {
    if (!path.empty() && path[path.size() - 1] != '/' && !path.push_back('/')) return false;
    for (size_t i = 0; i < name.size(); ++i)
        if (!path.push_back(name.c_str()[i])) return false;
    return true;
}

// One node and what is under it
template <typename NodeT>
static bool encode_one_param(QCBOREncodeContext* ctx,
                             const NodeT* child,
                             Vector<char>& path) {
    const size_t base = path.size();
    bool ok = path_push(path, child->meta.name);
    if (ok) {
        const auto& m = child->meta;

        QCBOREncode_OpenMap(ctx);

        // Integer keys: 1=path, 2=kind, 3=type, ..., 16=subs
        QCBOREncode_AddTextToMapN(ctx, 1, UsefulBufC{path.data(), path.size()});   // path
        QCBOREncode_AddInt64ToMapN(ctx, 2, static_cast<int64_t>(m.kind));   // kind
        QCBOREncode_AddInt64ToMapN(ctx, 3, static_cast<int64_t>(m.type));   // type
        QCBOREncode_AddInt64ToMapN(ctx, 4, static_cast<int64_t>(m.mode));   // mode
        QCBOREncode_AddInt64ToMapN(ctx, 5, static_cast<int64_t>(m.flow));   // flow
        QCBOREncode_AddDoubleToMapN(ctx, 6, static_cast<double>(m.rate));   // rate
        QCBOREncode_AddInt64ToMapN(ctx, 7, static_cast<int64_t>(m.access)); // access
        if (m.grounds()) {                                                  // ground [up, down] s
            QCBOREncode_OpenArrayInMapN(ctx, 8);
            QCBOREncode_AddDouble(ctx, static_cast<double>(m.ground_up));
            QCBOREncode_AddDouble(ctx, static_cast<double>(m.ground_down));
            QCBOREncode_CloseArray(ctx);
        }
        QCBOREncode_AddBoolToMapN(ctx, 9, m.hardware);                      // hardware

        // range sub-map (key 10)
        QCBOREncode_OpenMapInMapN(ctx, 10);
        encode_range_value(ctx, "min",  m.range_min);
        encode_range_value(ctx, "max",  m.range_max);
        if (readable(m.access))   // a write-only param's value stays home
            encode_range_value(ctx, "init", m.range_init);
        QCBOREncode_CloseMap(ctx);

        QCBOREncode_AddInt64ToMapN(ctx, 13, static_cast<int64_t>(m.nature));   // nature
        QCBOREncode_AddInt64ToMapN(ctx, 17, static_cast<int64_t>(m.topology)); // topology
        if (m.slots > 0)
            QCBOREncode_AddInt64ToMapN(ctx, 18, static_cast<int64_t>(m.slots)); // poly slots
        if (m.role != ParamRole::None)
            QCBOREncode_AddInt64ToMapN(ctx, 19, static_cast<int64_t>(m.role));
        if (m.full != FullPolicy::Steal)
            QCBOREncode_AddInt64ToMapN(ctx, 20, static_cast<int64_t>(m.full));
        if (m.grace_ms > 0)
            QCBOREncode_AddInt64ToMapN(ctx, 21, static_cast<int64_t>(m.grace_ms));
        if (m.hold >= 0.0f)
            QCBOREncode_AddDoubleToMapN(ctx, 22, static_cast<double>(m.hold));
        if (m.every)
            QCBOREncode_AddBoolToMapN(ctx, 23, true);
        if (m.ids != IdsMode::Auto)
            QCBOREncode_AddInt64ToMapN(ctx, 24, static_cast<int64_t>(m.ids));
        if (m.type == ParamType::Array) {                                   // 9.3
            QCBOREncode_AddInt64ToMapN(ctx, 25, static_cast<int64_t>(m.of));
            QCBOREncode_AddInt64ToMapN(ctx, 26, static_cast<int64_t>(m.size));
        }
        if (merge_of(m) != MergeMode::Ltp)                                  // merge (9.3), as applied
            QCBOREncode_AddInt64ToMapN(ctx, 27, static_cast<int64_t>(merge_of(m)));

        // Terse DECLARE: omit label/desc/unit on embedded
#ifndef DATAFLOU_SLIM_WORLDVIEW
        QCBOREncode_AddSZStringToMapN(ctx, 12, m.unit.c_str());   // unit
        QCBOREncode_AddSZStringToMapN(ctx, 14, m.label.c_str());  // label
        QCBOREncode_AddSZStringToMapN(ctx, 15, m.desc.c_str());   // desc
#endif

        // Subscriptions (key 16): no longer encoded in DECLARE.
        // Streaming is now destination-driven via StreamRequest messages.

        QCBOREncode_CloseMap(ctx);

        if (m.slots > 0) {
            // The template: slot "1" and what is under it
            for (size_t s = 0; s < child->children.size(); ++s) {
                if (child->children[s]->meta.name == "1") {
                    ok = encode_one_param(ctx, child->children[s], path);
                    break;
                }
            }
        } else if (child->children.size() > 0) {
            ok = encode_param_node(ctx, child, path);
        }
    }
    path.resize(base);
    return ok;
}

template <typename NodeT>
static bool encode_param_node(QCBOREncodeContext* ctx,
                              const NodeT* node,
                              Vector<char>& path) {
    for (size_t i = 0; i < node->children.size(); ++i)
        if (!encode_one_param(ctx, node->children[i], path)) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Scenes: the universe's cue (HELLO, DIGEST) and a node's status (DECLARE),
// as arrays of uints. Absent in messages from older nodes: left at defaults.
// ---------------------------------------------------------------------------

static void encode_scene_cue(QCBOREncodeContext* ctx, const SceneCue& cue) {
    QCBOREncode_OpenArrayInMapSZ(ctx, "scene");
    QCBOREncode_AddUInt64(ctx, cue.slot);
    QCBOREncode_AddUInt64(ctx, cue.stamp.counter);
    QCBOREncode_AddUInt64(ctx, cue.stamp.origin);
    QCBOREncode_CloseArray(ctx);
}

static void encode_scene_status(QCBOREncodeContext* ctx, const SceneStatus& st) {
    QCBOREncode_OpenArrayInMapSZ(ctx, "scene_status");
    QCBOREncode_AddUInt64(ctx, st.current);
    QCBOREncode_AddUInt64(ctx, static_cast<uint8_t>(st.state));
    QCBOREncode_AddUInt64(ctx, st.slots);
    QCBOREncode_AddUInt64(ctx, st.skipped);
    QCBOREncode_CloseArray(ctx);
}

// Read up to n uints from the array under `key`. False if absent.
static bool decode_uint_array(QCBORDecodeContext* ctx, const char* key,
                              uint64_t* out, size_t n) {
    QCBORDecode_EnterArrayFromMapSZ(ctx, key);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return false;
    for (size_t i = 0; i < n; ++i) QCBORDecode_GetUInt64(ctx, &out[i]);
    QCBORDecode_ExitArray(ctx);
    return QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS;
}

// A connection's id: [counter, origin] under "id", absent when it has none
static void encode_connection_id(QCBOREncodeContext* ctx, const ConnectionId& id) {
    if (id.empty()) return;
    QCBOREncode_OpenArrayInMapSZ(ctx, "id");
    QCBOREncode_AddUInt64(ctx, id.counter);
    QCBOREncode_AddUInt64(ctx, id.origin);
    QCBOREncode_CloseArray(ctx);
}

static void decode_connection_id(QCBORDecodeContext* ctx, ConnectionId& id) {
    uint64_t v[2] = {};
    if (!decode_uint_array(ctx, "id", v, 2) || v[0] == 0) return;
    id.counter = static_cast<uint32_t>(v[0]);
    id.origin  = static_cast<uint32_t>(v[1]);
}

static void encode_memory(QCBOREncodeContext* ctx, const MemoryState& m) {
    if (!m.said()) return;
    QCBOREncode_OpenArrayInMapSZ(ctx, "mem");
    QCBOREncode_AddUInt64(ctx, m.used);
    QCBOREncode_AddUInt64(ctx, m.room);
    QCBOREncode_CloseArray(ctx);
}

static void decode_memory(QCBORDecodeContext* ctx, MemoryState& m) {
    uint64_t v[2] = {};
    if (!decode_uint_array(ctx, "mem", v, 2)) return;
    m.used = static_cast<uint32_t>(std::min<uint64_t>(v[0], UINT32_MAX));
    m.room = static_cast<uint32_t>(std::min<uint64_t>(v[1], UINT32_MAX));
}

static void encode_clock(QCBOREncodeContext* ctx, const ClockState& c) {
    QCBOREncode_OpenArrayInMapSZ(ctx, "clock");
    QCBOREncode_AddUInt64(ctx, c.ref);
    QCBOREncode_AddUInt64(ctx, c.synced ? 1 : 0);
    QCBOREncode_CloseArray(ctx);
}

static void decode_clock(QCBORDecodeContext* ctx, ClockState& c) {
    uint64_t v[2] = {};
    if (!decode_uint_array(ctx, "clock", v, 2)) return;
    c.ref = static_cast<uint32_t>(v[0]);
    c.synced = v[1] != 0;
}

static const char* const FEATURE_NAMES[] = { "ids", "reply", "fire", "clock", "timed", "editable" };

const char* feature_name(uint32_t bit) {
    for (size_t i = 0; i < sizeof(FEATURE_NAMES) / sizeof(FEATURE_NAMES[0]); ++i)
        if (bit == (1u << i)) return FEATURE_NAMES[i];
    return nullptr;
}

static void encode_features(QCBOREncodeContext* ctx, uint32_t f) {
    QCBOREncode_OpenArrayInMapSZ(ctx, "feat");
    for (size_t i = 0; i < sizeof(FEATURE_NAMES) / sizeof(FEATURE_NAMES[0]); ++i)
        if (f & (1u << i)) QCBOREncode_AddSZString(ctx, FEATURE_NAMES[i]);
    QCBOREncode_CloseArray(ctx);
}

static uint32_t decode_features(QCBORDecodeContext* ctx) {
    uint32_t f = 0;
    QCBORDecode_EnterArrayFromMapSZ(ctx, "feat");
    if (QCBORDecode_GetError(ctx) != QCBOR_SUCCESS) { QCBORDecode_GetAndResetError(ctx); return 0; }
    for (int n = 0; n < 32; ++n) {
        UsefulBufC name = NULLUsefulBufC;
        QCBORDecode_GetTextString(ctx, &name);
        if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) break;
        for (size_t i = 0; i < sizeof(FEATURE_NAMES) / sizeof(FEATURE_NAMES[0]); ++i)
            if (name.len == strlen(FEATURE_NAMES[i]) &&
                memcmp(name.ptr, FEATURE_NAMES[i], name.len) == 0) f |= 1u << i;
    }
    QCBORDecode_ExitArray(ctx);
    QCBORDecode_GetAndResetError(ctx);
    return f;
}

// --- Connections (9.1, connection.h) ---
//
// A list under "c": each connection a map
//   {"id": [counter, origin], "d": dest, "s": source sku, "p": source path,
//    "poly": true (between populations), "l": [link, …]}
// a link {"d": rel dest, "s": rel source, "c": true (chosen by hand), "x": [axis, …]}
// an axis {"i": [min, max], "o": [min, max], "k": [x0, y0, x1, y1, …], "f": true}
// ({} when plain). Unknown keys are skipped: "a" (access) and "lut" (a
// colour table) are kept for what comes next.

static void encode_pair(QCBOREncodeContext* ctx, const char* key, double a, double b) {
    QCBOREncode_OpenArrayInMapSZ(ctx, key);
    QCBOREncode_AddDouble(ctx, a);
    QCBOREncode_AddDouble(ctx, b);
    QCBOREncode_CloseArray(ctx);
}

static bool decode_pair(QCBORDecodeContext* ctx, const char* key, double& a, double& b) {
    QCBORDecode_EnterArrayFromMapSZ(ctx, key);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return false;
    QCBORDecode_GetDouble(ctx, &a);
    QCBORDecode_GetDouble(ctx, &b);
    QCBORDecode_ExitArray(ctx);
    return QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS;
}

static void encode_axis(QCBOREncodeContext* ctx, const LinkAxis& a) {
    QCBOREncode_OpenMap(ctx);
    if (a.in_set)  encode_pair(ctx, "i", a.in_min, a.in_max);
    if (a.out_set) encode_pair(ctx, "o", a.out_min, a.out_max);
    if (!a.curve.straight()) {
        QCBOREncode_OpenArrayInMapSZ(ctx, "k");
        for (uint8_t i = 0; i < a.curve.n; ++i) {
            QCBOREncode_AddFloat(ctx, a.curve.x[i]);
            QCBOREncode_AddFloat(ctx, a.curve.y[i]);
        }
        QCBOREncode_CloseArray(ctx);
        if (a.curve.free) QCBOREncode_AddBoolToMapSZ(ctx, "f", true);
    }
    QCBOREncode_CloseMap(ctx);
}

static void decode_axis(QCBORDecodeContext* ctx, LinkAxis& a) {
    a.in_set  = decode_pair(ctx, "i", a.in_min, a.in_max);
    a.out_set = decode_pair(ctx, "o", a.out_min, a.out_max);
    QCBORDecode_EnterArrayFromMapSZ(ctx, "k");
    if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS) {
        uint8_t n = 0;
        while (n < CURVE_POINTS_MAX) {
            double x = 0, y = 0;
            QCBORDecode_GetDouble(ctx, &x);
            QCBORDecode_GetDouble(ctx, &y);
            if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) break;
            a.curve.x[n] = static_cast<float>(x);
            a.curve.y[n] = static_cast<float>(y);
            ++n;
        }
        a.curve.n = n;
        QCBORDecode_ExitArray(ctx);
        QCBORDecode_GetAndResetError(ctx);
    }
    bool f = false;
    QCBORDecode_GetBoolInMapSZ(ctx, "f", &f);
    if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS) a.curve.free = f;
}

static void encode_link(QCBOREncodeContext* ctx, const Link& l) {
    QCBOREncode_OpenMap(ctx);
    QCBOREncode_AddSZStringToMapSZ(ctx, "d", l.dest.c_str());
    QCBOREncode_AddSZStringToMapSZ(ctx, "s", l.source.c_str());
    if (l.chosen) QCBOREncode_AddBoolToMapSZ(ctx, "c", true);
    if (!l.plain()) {
        QCBOREncode_OpenArrayInMapSZ(ctx, "x");
        for (size_t i = 0; i < l.axes.size() && i < 4; ++i)   // a value has 4 components at most
            encode_axis(ctx, l.axes[i]);
        QCBOREncode_CloseArray(ctx);
    }
    QCBOREncode_CloseMap(ctx);
}

// Each map of the array entered last, f() inside it; stops at the first
// item that isn't a map
template <typename F>
static void for_each_map(QCBORDecodeContext* ctx, F&& f) {
    while (true) {
        QCBORItem peek;
        QCBORDecode_VPeekNext(ctx, &peek);
        if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS || peek.uDataType != QCBOR_TYPE_MAP)
            break;
        QCBORDecode_EnterMap(ctx, nullptr);
        f();
        QCBORDecode_ExitMap(ctx);
        if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) break;
    }
}

static bool decode_link(QCBORDecodeContext* ctx, Link& l) {
    UsefulBufC d = NULLUsefulBufC, s = NULLUsefulBufC;
    QCBORDecode_GetTextStringInMapSZ(ctx, "d", &d);
    QCBORDecode_GetTextStringInMapSZ(ctx, "s", &s);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return false;
    ubufc_to_etlstr(d, l.dest);
    ubufc_to_etlstr(s, l.source);
    bool c = false;
    QCBORDecode_GetBoolInMapSZ(ctx, "c", &c);
    l.chosen = QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS && c;
    QCBORDecode_EnterArrayFromMapSZ(ctx, "x");
    if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS) {
        for_each_map(ctx, [&] {
            if (l.axes.size() < 4) {
                LinkAxis* a = l.axes.emplace_back();
                if (a) decode_axis(ctx, *a);
            }
        });
        QCBORDecode_ExitArray(ctx);
        QCBORDecode_GetAndResetError(ctx);
    }
    return true;
}

// A connection's pick (9.1): {"id": n} or {"rank": n}; absent for none
static void encode_pick(QCBOREncodeContext* ctx, const Pick& p) {
    if (!p.any()) return;
    QCBOREncode_OpenMapInMapSZ(ctx, "pick");
    if (p.kind == Pick::Id) QCBOREncode_AddDoubleToMapSZ(ctx, "id", p.value);
    else QCBOREncode_AddInt64ToMapSZ(ctx, "rank", static_cast<int64_t>(p.value));
    QCBOREncode_CloseMap(ctx);
}

static void decode_pick(QCBORDecodeContext* ctx, Pick& p) {
    p = Pick{};
    QCBORDecode_EnterMapFromMapSZ(ctx, "pick");
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return;
    double id = 0;
    QCBORDecode_GetDoubleConvertAllInMapSZ(ctx, "id", QCBOR_CONVERT_TYPE_XINT64 | QCBOR_CONVERT_TYPE_FLOAT, &id);
    if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS) { p.kind = Pick::Id; p.value = id; }
    else {
        int64_t rank = 0;
        QCBORDecode_GetInt64InMapSZ(ctx, "rank", &rank);
        if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS && rank != 0) {
            p.kind = Pick::Rank;
            p.value = static_cast<double>(rank);
        }
    }
    QCBORDecode_ExitMap(ctx);
    QCBORDecode_GetAndResetError(ctx);
}

static void encode_connection_list(QCBOREncodeContext* ctx, const ConnectionList& list) {
    QCBOREncode_OpenArrayInMapSZ(ctx, "c");
    for (const auto& c : list) {
        QCBOREncode_OpenMap(ctx);
        encode_connection_id(ctx, c.id);
        QCBOREncode_AddSZStringToMapSZ(ctx, "d", c.dest.c_str());
        add_sku_to_map(ctx, "s", c.source_sku.c_str());
        QCBOREncode_AddSZStringToMapSZ(ctx, "p", c.source.c_str());
        if (c.poly) QCBOREncode_AddBoolToMapSZ(ctx, "poly", true);
        encode_pick(ctx, c.pick);
        QCBOREncode_OpenArrayInMapSZ(ctx, "l");
        for (const auto& l : c.links) encode_link(ctx, l);
        QCBOREncode_CloseArray(ctx);
        QCBOREncode_CloseMap(ctx);
    }
    QCBOREncode_CloseArray(ctx);
}

// False if the list can't be read; a connection that can't be read, or
// doesn't fit, is left out
static bool decode_connection_list(QCBORDecodeContext* ctx, ConnectionList& list) {
    QCBORDecode_EnterArrayFromMapSZ(ctx, "c");
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return false;
    for_each_map(ctx, [&] {
        Connection c;
        UsefulBufC d = NULLUsefulBufC, sku = NULLUsefulBufC, p = NULLUsefulBufC;
        QCBORDecode_GetTextStringInMapSZ(ctx, "d", &d);
        get_sku_in_map(ctx, "s", c.source_sku);
        QCBORDecode_GetTextStringInMapSZ(ctx, "p", &p);
        if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return;
        ubufc_to_etlstr(d, c.dest);
        ubufc_to_etlstr(p, c.source);
        decode_connection_id(ctx, c.id);
        QCBORDecode_GetAndResetError(ctx);
        bool poly = false;
        QCBORDecode_GetBoolInMapSZ(ctx, "poly", &poly);
        c.poly = QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS && poly;
        decode_pick(ctx, c.pick);
        QCBORDecode_EnterArrayFromMapSZ(ctx, "l");
        if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS) {
            for_each_map(ctx, [&] {
                Link l;
                if (decode_link(ctx, l)) c.links.push_back(std::move(l));
            });
            QCBORDecode_ExitArray(ctx);
            QCBORDecode_GetAndResetError(ctx);
        }
        list.push_back(std::move(c));
    });
    QCBORDecode_ExitArray(ctx);
    return QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS;
}

size_t encode_connection_record(etl::span<uint8_t> buf, uint32_t version, const ConnectionList& list) {
    QCBOREncodeContext ctx;
    QCBOREncode_Init(&ctx, UsefulBuf{buf.data(), buf.size()});
    QCBOREncode_OpenMap(&ctx);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "f", 1);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "v", version);
    encode_connection_list(&ctx, list);
    return finish_encode(&ctx);
}

bool decode_connection_record(etl::span<const uint8_t> data, uint32_t& version, ConnectionList& list) {
    QCBORDecodeContext ctx;
    QCBORDecode_Init(&ctx, UsefulBufC{data.data(), data.size()}, QCBOR_DECODE_MODE_NORMAL);
    QCBORDecode_EnterMap(&ctx, nullptr);
    uint64_t f = 0, v = 0;
    QCBORDecode_GetUInt64InMapSZ(&ctx, "f", &f);
    QCBORDecode_GetUInt64InMapSZ(&ctx, "v", &v);
    if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS || f != 1) return false;
    version = static_cast<uint32_t>(v);
    return decode_connection_list(&ctx, list);
}

static void encode_phase_cue(QCBOREncodeContext* ctx, const PhaseCue& cue) {
    if (cue.stamp.empty()) return;              // never set: nothing to say
    QCBOREncode_OpenArrayInMapSZ(ctx, "phase");
    QCBOREncode_AddUInt64(ctx, static_cast<uint8_t>(cue.phase));
    QCBOREncode_AddUInt64(ctx, cue.stamp.counter);
    QCBOREncode_AddUInt64(ctx, cue.stamp.origin);
    QCBOREncode_CloseArray(ctx);
}

static void encode_halt_cue(QCBOREncodeContext* ctx, const HaltCue& cue) {
    if (cue.stamp.empty()) return;              // never set: nothing to say
    QCBOREncode_OpenArrayInMapSZ(ctx, "halt");
    QCBOREncode_AddUInt64(ctx, cue.on ? 1 : 0);
    QCBOREncode_AddUInt64(ctx, cue.stamp.counter);
    QCBOREncode_AddUInt64(ctx, cue.stamp.origin);
    QCBOREncode_CloseArray(ctx);
}

static void decode_halt_cue(QCBORDecodeContext* ctx, HaltCue& cue) {
    uint64_t v[3] = {};
    if (!decode_uint_array(ctx, "halt", v, 3) || v[0] > 1 || v[1] == 0) return;
    cue.on            = v[0] == 1;
    cue.stamp.counter = static_cast<uint32_t>(v[1]);
    cue.stamp.origin  = static_cast<uint32_t>(v[2]);
}

static void decode_phase_cue(QCBORDecodeContext* ctx, PhaseCue& cue) {
    uint64_t v[3] = {};
    if (!decode_uint_array(ctx, "phase", v, 3) || v[0] > 1 || v[1] == 0) return;
    cue.phase         = static_cast<Phase>(v[0]);
    cue.stamp.counter = static_cast<uint32_t>(v[1]);
    cue.stamp.origin  = static_cast<uint32_t>(v[2]);
}

static void decode_scene_cue(QCBORDecodeContext* ctx, SceneCue& cue) {
    uint64_t v[3] = {};
    if (!decode_uint_array(ctx, "scene", v, 3) || v[0] > 255) return;
    cue.slot          = static_cast<uint8_t>(v[0]);
    cue.stamp.counter = static_cast<uint32_t>(v[1]);
    cue.stamp.origin  = static_cast<uint32_t>(v[2]);
}

static void decode_scene_status(QCBORDecodeContext* ctx, SceneStatus& st) {
    uint64_t v[4] = {};
    if (!decode_uint_array(ctx, "scene_status", v, 4)) return;
    st.current = v[0] <= 255 ? static_cast<uint8_t>(v[0]) : 0;
    st.state   = v[1] <= static_cast<uint8_t>(SceneState::Missing)
                     ? static_cast<SceneState>(v[1]) : SceneState::None;
    st.slots   = static_cast<uint32_t>(v[2]);
    st.skipped = v[3] <= 255 ? static_cast<uint8_t>(v[3]) : 255;
}

// ---------------------------------------------------------------------------
// Public encode functions
// ---------------------------------------------------------------------------

size_t encode_hello(etl::span<uint8_t> buf,
                    uint32_t seq, const char* from_sku,
                    const MsgHello& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "HELLO", seq);
    add_sku_to_map(&ctx, "from", from_sku);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "proto", msg.proto);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "univ", msg.universe.c_str());
    encode_identity(&ctx, msg.identity);
    encode_versions(&ctx, msg.versions);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "listen_port", msg.listen_port);
    encode_scene_cue(&ctx, msg.scene);
    encode_phase_cue(&ctx, msg.phase);
    encode_halt_cue(&ctx, msg.halt);
    if (msg.max_frame > 0)
        QCBOREncode_AddUInt64ToMapSZ(&ctx, "max_frame", msg.max_frame);
    if (msg.role != NodeRole::Full)
        QCBOREncode_AddSZStringToMapSZ(&ctx, "role", to_string(msg.role));
    encode_memory(&ctx, msg.mem);
    encode_features(&ctx, msg.features);
    encode_clock(&ctx, msg.clock);
    encode_versions(&ctx, msg.conn_versions, "cv");

    return finish_encode(&ctx);
}

template <typename StoreT>
static size_t encode_declare_impl(etl::span<uint8_t> buf,
                                   uint32_t seq,
                                   const MsgDeclare& msg, const StoreT& params) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "DECLARE", seq);
    add_sku_to_map(&ctx, "about", msg.about_sku.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "decl_version", msg.decl_version);
    encode_identity(&ctx, msg.identity);
    encode_scene_status(&ctx, msg.scene);
    if (!msg.at_address.empty() && msg.at_port) {
        QCBOREncode_AddSZStringToMapSZ(&ctx, "at_addr", msg.at_address.c_str());
        QCBOREncode_AddUInt64ToMapSZ(&ctx, "at_port", msg.at_port);
    }

    // Encode params array from the param tree
    QCBOREncode_OpenArrayInMapSZ(&ctx, "params");
    auto* root = params.root();
    if (root != nullptr) {
        Vector<char> path;
        if (!encode_param_node(&ctx, root, path)) return 0;
    }
    QCBOREncode_CloseArray(&ctx);

    return finish_encode(&ctx);
}

size_t encode_declare(etl::span<uint8_t> buf,
                      uint32_t seq,
                      const MsgDeclare& msg, const ParamStore& params) {
    return encode_declare_impl(buf, seq, msg, params);
}

#ifdef DATAFLOU_SLIM_WORLDVIEW
size_t encode_declare(etl::span<uint8_t> buf,
                      uint32_t seq,
                      const MsgDeclare& msg, const ParamStoreSlim& params) {
    return encode_declare_impl(buf, seq, msg, params);
}
#endif

size_t encode_ack(etl::span<uint8_t> buf,
                  uint32_t seq,
                  const MsgAck& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "ACK", seq);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "ack_seq", msg.ack_seq);

    return finish_encode(&ctx);
}

size_t encode_leave(etl::span<uint8_t> buf,
                    uint32_t seq) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "LEAVE", seq);

    return finish_encode(&ctx);
}

size_t encode_identify(etl::span<uint8_t> buf,
                    uint32_t seq) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "IDENTIFY", seq);

    return finish_encode(&ctx);
}

size_t encode_detach(etl::span<uint8_t> buf, uint32_t seq) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "DETACH", seq);

    return finish_encode(&ctx);
}

size_t encode_digest(etl::span<uint8_t> buf,
                     uint32_t seq,
                     const MsgDigest& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "DIGEST", seq);
    encode_versions(&ctx, msg.versions);
    encode_scene_cue(&ctx, msg.scene);
    encode_phase_cue(&ctx, msg.phase);
    encode_halt_cue(&ctx, msg.halt);
    encode_memory(&ctx, msg.mem);
    encode_clock(&ctx, msg.clock);
    encode_versions(&ctx, msg.conn_versions, "cv");

    return finish_encode(&ctx);
}

size_t encode_flush(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgFlush& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "FLUSH", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());

    return finish_encode(&ctx);
}

size_t encode_sub_request(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgSubRequest& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "SUBREQ", seq);
    QCBOREncode_AddBoolToMapSZ(&ctx, "sub", msg.subscribe);
    add_sku_to_map(&ctx, "dest_sku", msg.dest_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "dest_path", msg.dest_path.c_str());
    add_sku_to_map(&ctx, "src_sku", msg.source_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "src_path", msg.source_path.c_str());
    encode_connection_id(&ctx, msg.id);
    encode_pick(&ctx, msg.pick);

    return finish_encode(&ctx);
}

size_t encode_set_value(etl::span<uint8_t> buf,
                        uint32_t seq,
                        const MsgSetValue& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "SETVAL", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "path", msg.path.c_str());
    QCBOREncode_AddInt64ToMapSZ(&ctx, "vtype", static_cast<int64_t>(msg.value.tag));
    if (msg.value.unknown) QCBOREncode_AddBoolToMapSZ(&ctx, "unk", true);   // 9.1: no value known

    switch (msg.value.unknown ? ParamType::Trigger : msg.value.tag) {
    case ParamType::Bool:
        QCBOREncode_AddBoolToMapSZ(&ctx, "val", msg.value.b);
        break;
    case ParamType::Number:
        QCBOREncode_AddDoubleToMapSZ(&ctx, "val", msg.value.n);
        break;
    case ParamType::String:
        QCBOREncode_AddSZStringToMapSZ(&ctx, "val", msg.value.s.c_str());
        break;
    case ParamType::Blob:   // its bytes, as the stream carries them
        QCBOREncode_AddBytesToMapSZ(&ctx, "val", UsefulBufC{msg.value.s.c_str(), msg.value.s.size()});
        break;
    case ParamType::V2:
        QCBOREncode_OpenArrayInMapSZ(&ctx, "val");
        QCBOREncode_AddDouble(&ctx, msg.value.v2[0]);
        QCBOREncode_AddDouble(&ctx, msg.value.v2[1]);
        QCBOREncode_CloseArray(&ctx);
        break;
    case ParamType::V3:
        QCBOREncode_OpenArrayInMapSZ(&ctx, "val");
        QCBOREncode_AddDouble(&ctx, msg.value.v3[0]);
        QCBOREncode_AddDouble(&ctx, msg.value.v3[1]);
        QCBOREncode_AddDouble(&ctx, msg.value.v3[2]);
        QCBOREncode_CloseArray(&ctx);
        break;
    case ParamType::V4:
        QCBOREncode_OpenArrayInMapSZ(&ctx, "val");
        QCBOREncode_AddDouble(&ctx, msg.value.v4[0]);
        QCBOREncode_AddDouble(&ctx, msg.value.v4[1]);
        QCBOREncode_AddDouble(&ctx, msg.value.v4[2]);
        QCBOREncode_AddDouble(&ctx, msg.value.v4[3]);
        QCBOREncode_CloseArray(&ctx);
        break;
    case ParamType::Colour:
        QCBOREncode_OpenArrayInMapSZ(&ctx, "val");
        QCBOREncode_AddInt64(&ctx, msg.value.rgba[0]);
        QCBOREncode_AddInt64(&ctx, msg.value.rgba[1]);
        QCBOREncode_AddInt64(&ctx, msg.value.rgba[2]);
        QCBOREncode_AddInt64(&ctx, msg.value.rgba[3]);
        QCBOREncode_CloseArray(&ctx);
        break;
    case ParamType::Array: {   // 9.3: the bytes a stream entry carries
        const size_t n = array_wire_size(msg.value);
        UsefulBuf place = NULLUsefulBuf;
        QCBOREncode_OpenBytesInMapSZ(&ctx, "val", &place);
        if (place.ptr && place.len >= n) {
            write_array(static_cast<uint8_t*>(place.ptr), msg.value);
            QCBOREncode_CloseBytes(&ctx, n);
        } else if (place.ptr) {
            QCBOREncode_CloseBytes(&ctx, 0);
            return 0;
        }
        break;
    }
    default:
        break;
    }

    return finish_encode(&ctx);
}

size_t encode_param_admin(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgParamAdmin& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "PADMIN", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "payload", msg.payload.c_str());

    return finish_encode(&ctx);
}

size_t encode_blob(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgBlob& msg,
                   etl::span<const uint8_t> data) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "BLOB", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "key", msg.key.c_str());
    QCBOREncode_AddBytesToMapSZ(&ctx, "data",
        UsefulBufC{data.data(), data.size()});

    return finish_encode(&ctx);
}

size_t encode_blob_req(etl::span<uint8_t> buf,
                       uint32_t seq,
                       const MsgBlobReq& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "BLOBREQ", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "key", msg.key.c_str());

    return finish_encode(&ctx);
}

size_t encode_stream_request(etl::span<uint8_t> buf,
                             uint32_t seq,
                             const MsgStreamRequest& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "STREAMREQ", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "source_path", msg.source_path.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "dest_path", msg.dest_path.c_str());
    add_sku_to_map(&ctx, "dest_sku", msg.dest_sku.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "dest_udp_port", msg.dest_udp_port);
    QCBOREncode_AddDoubleToMapSZ(&ctx, "rate_hz", static_cast<double>(msg.rate_hz));
    if (msg.stream_id) QCBOREncode_AddUInt64ToMapSZ(&ctx, "sid", msg.stream_id);
    if (!msg.conn.empty()) {
        QCBOREncode_OpenArrayInMapSZ(&ctx, "conn");
        QCBOREncode_AddUInt64(&ctx, msg.conn.counter);
        QCBOREncode_AddUInt64(&ctx, msg.conn.origin);
        QCBOREncode_CloseArray(&ctx);
    }

    return finish_encode(&ctx);
}

size_t encode_stream_stop(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgStreamStop& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "STREAMSTOP", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "source_path", msg.source_path.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "dest_path", msg.dest_path.c_str());
    add_sku_to_map(&ctx, "dest_sku", msg.dest_sku.c_str());

    return finish_encode(&ctx);
}

size_t encode_stream_reply(etl::span<uint8_t> buf,
                           uint32_t seq,
                           const MsgStreamReply& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "STREAMREPLY", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "source_path", msg.source_path.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "dest_path", msg.dest_path.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "type", static_cast<uint8_t>(msg.shape.type));
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "mode", static_cast<uint8_t>(msg.shape.mode));
    if (msg.shape.type == ParamType::Array) {    // 9.3; its range is one element's
        QCBOREncode_AddUInt64ToMapSZ(&ctx, "of", static_cast<uint8_t>(msg.shape.of));
        QCBOREncode_AddUInt64ToMapSZ(&ctx, "size", msg.shape.size);
    }
    encode_range_value(&ctx, "min", msg.shape.range_min);
    encode_range_value(&ctx, "max", msg.shape.range_max);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "id", msg.stream_id);

    return finish_encode(&ctx);
}

size_t encode_time(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgTime& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "TIME", seq);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "t0", msg.t0);
    if (msg.reply) {
        QCBOREncode_AddUInt64ToMapSZ(&ctx, "mesh", msg.mesh);
        encode_clock(&ctx, msg.clock);
    }

    return finish_encode(&ctx);
}

size_t encode_fire(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgFire& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "FIRE", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "source_path", msg.source_path.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "dest_path", msg.dest_path.c_str());
    if (msg.at) QCBOREncode_AddUInt64ToMapSZ(&ctx, "at", msg.at);   // 9.3: a stamped trigger

    return finish_encode(&ctx);
}

size_t encode_conns(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgConns& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "CONNS", seq);
    add_sku_to_map(&ctx, "about", msg.about_sku.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "v", msg.version);
    encode_connection_list(&ctx, msg.list);

    return finish_encode(&ctx);
}

size_t encode_ended(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgEnded& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "ENDED", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "pop", msg.source_path.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "slot", msg.source_slot);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "why", to_string(msg.reason));
    if (msg.has_instance) QCBOREncode_AddDoubleToMapSZ(&ctx, "id", msg.instance);

    return finish_encode(&ctx);
}

size_t encode_link_edit(etl::span<uint8_t> buf,
                        uint32_t seq,
                        const MsgLinkEdit& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "LINKEDIT", seq);
    add_sku_to_map(&ctx, "dest", msg.dest_sku.c_str());
    encode_connection_id(&ctx, msg.id);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "w", msg.what);
    QCBOREncode_OpenArrayInMapSZ(&ctx, "l");
    encode_link(&ctx, msg.link);
    QCBOREncode_CloseArray(&ctx);

    return finish_encode(&ctx);
}

size_t encode_scene(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgScene& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "SCENE", seq);
    QCBOREncode_AddSZStringToMapSZ(&ctx, "op", to_string(msg.op));
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "slot", msg.slot);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "counter", msg.stamp.counter);
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "origin", msg.stamp.origin);

    return finish_encode(&ctx);
}

size_t encode_halt(etl::span<uint8_t> buf, uint32_t seq, const MsgHalt& msg) {
    QCBOREncodeContext ctx;
    QCBOREncode_Init(&ctx, UsefulBuf{buf.data(), buf.size()});
    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "HALT", seq);
    encode_halt_cue(&ctx, msg.cue);
    return finish_encode(&ctx);
}

size_t encode_locate(etl::span<uint8_t> buf, uint32_t seq, const MsgLocate& msg) {
    QCBOREncodeContext ctx;
    QCBOREncode_Init(&ctx, UsefulBuf{buf.data(), buf.size()});
    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "LOCATE", seq);
    add_sku_to_map(&ctx, "target", msg.target_sku.c_str());
    QCBOREncode_AddSZStringToMapSZ(&ctx, "path", msg.path.c_str());
    QCBOREncode_AddUInt64ToMapSZ(&ctx, "ms", msg.ms);
    return finish_encode(&ctx);
}

size_t encode_phase(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgPhase& msg) {
    QCBOREncodeContext ctx;
    UsefulBuf out_buf = {buf.data(), buf.size()};
    QCBOREncode_Init(&ctx, out_buf);

    QCBOREncode_OpenMap(&ctx);
    encode_header(&ctx, "PHASE", seq);
    encode_phase_cue(&ctx, msg.cue);

    return finish_encode(&ctx);
}

// ---------------------------------------------------------------------------
// Decode helpers
// ---------------------------------------------------------------------------

// Decode a NodeIdentity from the "identity" sub-map.
// Assumes the decoder is positioned inside the parent map.
static bool decode_identity(QCBORDecodeContext* ctx, NodeIdentity& id) {
    id = NodeIdentity{};
    QCBORDecode_EnterMapFromMapSZ(ctx, "identity");

    // No identity map (or the message was already broken): nothing to read
    // and nothing to leave. The error stays set, so the message is refused.
    if (QCBORDecode_GetError(ctx) != QCBOR_SUCCESS) return false;

    // Empty until read: a field that is missing or of the wrong type leaves
    // its buffer untouched, and must not stop the ones after it (the
    // decoder's error is sticky).
    UsefulBufC label_buf = NULLUsefulBufC,
               product_buf = NULLUsefulBufC, state_buf = NULLUsefulBufC;
    uint64_t version_u64 = 0;

    get_sku_in_map(ctx, "sku", id.sku);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetTextStringInMapSZ(ctx, "label", &label_buf);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) label_buf = NULLUsefulBufC;
    QCBORDecode_GetTextStringInMapSZ(ctx, "product", &product_buf);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) product_buf = NULLUsefulBufC;
    QCBORDecode_GetUInt64InMapSZ(ctx, "version", &version_u64);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) version_u64 = 0;
    QCBORDecode_GetTextStringInMapSZ(ctx, "state", &state_buf);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) state_buf = NULLUsefulBufC;

    QCBORDecode_ExitMap(ctx);

    ubufc_to_etlstr(label_buf, id.label);
    ubufc_to_etlstr(product_buf, id.product);
    id.version = static_cast<uint32_t>(version_u64);

    if (state_buf.ptr != nullptr && state_buf.len > 0) {
        id.state = parse_node_state(state_buf);
    } else {
        id.state = NodeState::Active;
    }

    return true;
}

// Decode a version vector from the sub-map under `key`.
static bool decode_versions(QCBORDecodeContext* ctx,
                            WorldView::VersionVector& versions,
                            const char* key = "versions") {
    QCBORDecode_EnterMapFromMapSZ(ctx, key);
    if (QCBORDecode_GetError(ctx) != QCBOR_SUCCESS) return false;

    // Iterate over all entries in the versions map
    QCBORItem item;
    while (true) {
        QCBORDecode_VGetNext(ctx, &item);
        QCBORError err = QCBORDecode_GetError(ctx);
        if (err != QCBOR_SUCCESS) {
            // If we hit the end of the map or an error, stop.
            // Reset the error since exiting the map will handle end-of-map.
            QCBORDecode_GetAndResetError(ctx);
            break;
        }

        // Sku keys (bytes, or text) and uint values
        if (item.uLabelType != QCBOR_TYPE_BYTE_STRING && item.uLabelType != QCBOR_TYPE_TEXT_STRING) {
            break;
        }
        if (item.uDataType != QCBOR_TYPE_INT64 &&
            item.uDataType != QCBOR_TYPE_UINT64) {
            break;
        }

        etl::string<36> sku;
        sku_from(item.uLabelType, item.label.string, sku);
        if (sku.empty()) break;

        uint32_t ver = 0;
        if (item.uDataType == QCBOR_TYPE_UINT64) {
            ver = static_cast<uint32_t>(item.val.uint64);
        } else {
            ver = static_cast<uint32_t>(item.val.int64);
        }

        if (!versions.full()) {
            versions[sku] = ver;
        }
    }

    QCBORDecode_ExitMap(ctx);
    return true;
}

// ---------------------------------------------------------------------------
// decode_message — generic message decoder (all types except DECLARE params)
// ---------------------------------------------------------------------------

static void decode_range_value(QCBORDecodeContext* ctx, const char* key,
                               ParamType type, ParamValueCore& out);

bool decode_message(etl::span<const uint8_t> data, DecodedMsg& out) {
    QCBORDecodeContext ctx;
    UsefulBufC input = {data.data(), data.size()};
    QCBORDecode_Init(&ctx, input, QCBOR_DECODE_MODE_NORMAL);

    QCBORDecode_EnterMap(&ctx, nullptr);

    // Read common header fields
    UsefulBufC msg_buf = NULLUsefulBufC;
    uint64_t seq_u64 = 0;

    QCBORDecode_GetTextStringInMapSZ(&ctx, "msg", &msg_buf);
    QCBORDecode_GetUInt64InMapSZ(&ctx, "seq", &seq_u64);
    get_sku_in_map(&ctx, "from", out.from_sku);   // in a HELLO

    QCBORError err = QCBORDecode_GetError(&ctx);
    if (err != QCBOR_SUCCESS) {
        // seq might be missing for LEAVE/DIGEST — reset and continue
        QCBORDecode_GetAndResetError(&ctx);
    }

    out.seq = static_cast<uint32_t>(seq_u64);

    if (msg_buf.ptr == nullptr) {
        return false;
    }

    // Dispatch on message type
    if (str_eq(msg_buf, "HELLO")) {
        out.type = MsgType::Hello;
        // Placement construct the union member
        new (&out.hello) MsgHello();
        out.live = true;

        uint64_t proto_u64 = 1;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "proto", &proto_u64);
        // Reset error in case proto is missing (optional)
        QCBORDecode_GetAndResetError(&ctx);
        out.hello.proto = static_cast<uint8_t>(proto_u64);

        decode_identity(&ctx, out.hello.identity);
        QCBORDecode_GetAndResetError(&ctx);

        decode_versions(&ctx, out.hello.versions);
        QCBORDecode_GetAndResetError(&ctx);

        uint64_t listen_port_u64 = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "listen_port", &listen_port_u64);
        QCBORDecode_GetAndResetError(&ctx);
        out.hello.listen_port = static_cast<uint16_t>(listen_port_u64);

        decode_scene_cue(&ctx, out.hello.scene);
        QCBORDecode_GetAndResetError(&ctx);
        decode_phase_cue(&ctx, out.hello.phase);
        QCBORDecode_GetAndResetError(&ctx);
        decode_halt_cue(&ctx, out.hello.halt);
        QCBORDecode_GetAndResetError(&ctx);

        // Since 8.2; absent from older peers
        uint64_t max_frame_u64 = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "max_frame", &max_frame_u64);
        QCBORDecode_GetAndResetError(&ctx);
        out.hello.max_frame = static_cast<uint32_t>(std::min<uint64_t>(max_frame_u64, UINT32_MAX));
        UsefulBufC univ_buf = NULLUsefulBufC;
        QCBORDecode_GetTextStringInMapSZ(&ctx, "univ", &univ_buf);
        if (QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS)
            ubufc_to_etlstr(univ_buf, out.hello.universe);
        decode_memory(&ctx, out.hello.mem);
        QCBORDecode_GetAndResetError(&ctx);
        out.hello.features = decode_features(&ctx);
        decode_clock(&ctx, out.hello.clock);
        QCBORDecode_GetAndResetError(&ctx);
        decode_versions(&ctx, out.hello.conn_versions, "cv");
        QCBORDecode_GetAndResetError(&ctx);

        UsefulBufC role_buf = {nullptr, 0};
        QCBORDecode_GetTextStringInMapSZ(&ctx, "role", &role_buf);
        QCBORDecode_GetAndResetError(&ctx);
        out.hello.role = !role_buf.ptr ? NodeRole::Full
                       : str_eq(role_buf, "source") ? NodeRole::Source
                       : str_eq(role_buf, "satellite") ? NodeRole::Satellite
                       : NodeRole::Full;

    } else if (str_eq(msg_buf, "ACK")) {
        out.type = MsgType::Ack;
        new (&out.ack) MsgAck();
        out.live = true;

        uint64_t ack_seq_u64 = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "ack_seq", &ack_seq_u64);
        out.ack.ack_seq = static_cast<uint32_t>(ack_seq_u64);

    } else if (str_eq(msg_buf, "LEAVE")) {
        out.type = MsgType::Leave;
        new (&out.leave) MsgLeave();
        out.live = true;

    } else if (str_eq(msg_buf, "IDENTIFY")) {
        out.type = MsgType::Identify;
        new (&out.identify) MsgIdentify();
        out.live = true;

    } else if (str_eq(msg_buf, "DETACH")) {
        out.type = MsgType::Detach;
        new (&out.detach) MsgDetach();
        out.live = true;

    } else if (str_eq(msg_buf, "DIGEST")) {
        out.type = MsgType::Digest;
        new (&out.digest) MsgDigest();
        out.live = true;

        decode_versions(&ctx, out.digest.versions);
        QCBORDecode_GetAndResetError(&ctx);

        decode_scene_cue(&ctx, out.digest.scene);
        QCBORDecode_GetAndResetError(&ctx);
        decode_phase_cue(&ctx, out.digest.phase);
        QCBORDecode_GetAndResetError(&ctx);
        decode_halt_cue(&ctx, out.digest.halt);
        QCBORDecode_GetAndResetError(&ctx);
        decode_memory(&ctx, out.digest.mem);
        QCBORDecode_GetAndResetError(&ctx);
        decode_clock(&ctx, out.digest.clock);
        QCBORDecode_GetAndResetError(&ctx);
        decode_versions(&ctx, out.digest.conn_versions, "cv");
        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "HALT")) {
        out.type = MsgType::Halt;
        new (&out.halt) MsgHalt();
        out.live = true;
        decode_halt_cue(&ctx, out.halt.cue);
        if (out.halt.cue.stamp.empty()) return false;

    } else if (str_eq(msg_buf, "LOCATE")) {
        out.type = MsgType::Locate;
        new (&out.locate) MsgLocate();
        out.live = true;
        UsefulBufC target_buf = NULLUsefulBufC, path_buf = NULLUsefulBufC;
        uint64_t ms = 0;
        get_sku_in_map(&ctx, "target", out.locate.target_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "path", &path_buf);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "ms", &ms);
        if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS) return false;
        ubufc_to_etlstr(path_buf, out.locate.path);
        out.locate.ms = static_cast<uint32_t>(std::min<uint64_t>(ms, 60000));

    } else if (str_eq(msg_buf, "PHASE")) {
        out.type = MsgType::Phase;
        new (&out.phase) MsgPhase();
        out.live = true;
        decode_phase_cue(&ctx, out.phase.cue);
        if (out.phase.cue.stamp.empty()) return false;

    } else if (str_eq(msg_buf, "FLUSH")) {
        out.type = MsgType::Flush;
        new (&out.flush) MsgFlush();
        out.live = true;

        UsefulBufC target_buf = NULLUsefulBufC;
        get_sku_in_map(&ctx, "target", out.flush.target_sku);

    } else if (str_eq(msg_buf, "SUBREQ")) {
        out.type = MsgType::SubRequest;
        new (&out.sub_request) MsgSubRequest();
        out.live = true;

        UsefulBufC dest_sku_buf = NULLUsefulBufC;
        UsefulBufC dest_path_buf = NULLUsefulBufC;
        UsefulBufC src_sku_buf = NULLUsefulBufC;
        UsefulBufC src_path_buf = NULLUsefulBufC;

        QCBORDecode_GetBoolInMapSZ(&ctx, "sub", &out.sub_request.subscribe);
        get_sku_in_map(&ctx, "dest_sku", out.sub_request.dest_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "dest_path", &dest_path_buf);
        get_sku_in_map(&ctx, "src_sku", out.sub_request.source_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "src_path", &src_path_buf);

        ubufc_to_etlstr(dest_path_buf, out.sub_request.dest_path);
        ubufc_to_etlstr(src_path_buf, out.sub_request.source_path);
        QCBORDecode_GetAndResetError(&ctx);
        decode_connection_id(&ctx, out.sub_request.id);
        decode_pick(&ctx, out.sub_request.pick);

    } else if (str_eq(msg_buf, "SETVAL")) {
        out.type = MsgType::SetValue;
        new (&out.set_value) MsgSetValue();
        out.live = true;

        UsefulBufC target_buf = NULLUsefulBufC;
        UsefulBufC path_buf = NULLUsefulBufC;
        int64_t vtype_i64 = 0;

        get_sku_in_map(&ctx, "target", out.set_value.target_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "path", &path_buf);
        QCBORDecode_GetInt64InMapSZ(&ctx, "vtype", &vtype_i64);

        ubufc_to_etlstr(path_buf, out.set_value.path);
        out.set_value.value.tag = static_cast<ParamType>(vtype_i64);
        {
            bool unk = false;
            QCBORDecode_GetBoolInMapSZ(&ctx, "unk", &unk);
            out.set_value.value.unknown = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS && unk;
        }

        switch (out.set_value.value.tag) {
        case ParamType::Bool:
            QCBORDecode_GetBoolInMapSZ(&ctx, "val", &out.set_value.value.b);
            break;
        case ParamType::Number:
            QCBORDecode_GetDoubleInMapSZ(&ctx, "val", &out.set_value.value.n);
            break;
        case ParamType::String: {
            UsefulBufC val_buf = NULLUsefulBufC;
            QCBORDecode_GetTextStringInMapSZ(&ctx, "val", &val_buf);
            ubufc_to_etlstr(val_buf, out.set_value.value.s);
            break;
        }
        case ParamType::Blob: {
            UsefulBufC val_buf = NULLUsefulBufC;
            QCBORDecode_GetByteStringInMapSZ(&ctx, "val", &val_buf);
            ubufc_to_etlstr(val_buf, out.set_value.value.s);
            break;
        }
        case ParamType::V2:
        case ParamType::V3:
        case ParamType::V4: {
            QCBORDecode_EnterArrayFromMapSZ(&ctx, "val");
            int dim = (out.set_value.value.tag == ParamType::V2) ? 2 :
                      (out.set_value.value.tag == ParamType::V3) ? 3 : 4;
            double tmp = 0;
            for (int i = 0; i < dim; ++i) {
                QCBORDecode_GetDouble(&ctx, &tmp);
                out.set_value.value.v4[i] = static_cast<float>(tmp);
            }
            QCBORDecode_ExitArray(&ctx);
            break;
        }
        case ParamType::Colour: {
            QCBORDecode_EnterArrayFromMapSZ(&ctx, "val");
            for (int i = 0; i < 4; ++i) {
                int64_t tmp = 0;
                QCBORDecode_GetInt64(&ctx, &tmp);
                out.set_value.value.rgba[i] = static_cast<uint8_t>(tmp & 0xFF);
            }
            QCBORDecode_ExitArray(&ctx);
            break;
        }
        case ParamType::Array: {   // 9.3: as a stream entry carries it
            if (out.set_value.value.unknown) break;
            UsefulBufC val_buf = NULLUsefulBufC;
            QCBORDecode_GetByteStringInMapSZ(&ctx, "val", &val_buf);
            if (QCBORDecode_GetError(&ctx) != QCBOR_SUCCESS || !val_buf.ptr ||
                !read_array(static_cast<const uint8_t*>(val_buf.ptr), val_buf.len, out.set_value.value)) {
                out.set_value.value = ParamValue{};
                out.set_value.value.tag = ParamType::Array;
                out.set_value.value.unknown = true;      // not one we read: nothing set
                out.set_value.unread = true;
            }
            break;
        }
        default:
            break;
        }
        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "PADMIN")) {
        out.type = MsgType::ParamAdmin;
        new (&out.param_admin) MsgParamAdmin();
        out.live = true;

        UsefulBufC target_buf = NULLUsefulBufC;
        UsefulBufC payload_buf = NULLUsefulBufC;

        get_sku_in_map(&ctx, "target", out.param_admin.target_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "payload", &payload_buf);

        ubufc_to_etlstr(payload_buf, out.param_admin.payload);

        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "BLOB")) {
        out.type = MsgType::Blob;
        new (&out.blob) MsgBlob();
        out.live = true;

        UsefulBufC target_buf = NULLUsefulBufC;
        UsefulBufC key_buf = NULLUsefulBufC;

        get_sku_in_map(&ctx, "target", out.blob.target_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "key", &key_buf);

        ubufc_to_etlstr(key_buf, out.blob.key);

        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "BLOBREQ")) {
        out.type = MsgType::BlobReq;
        new (&out.blob_req) MsgBlobReq();
        out.live = true;

        UsefulBufC target_buf = NULLUsefulBufC;
        UsefulBufC key_buf = NULLUsefulBufC;

        get_sku_in_map(&ctx, "target", out.blob_req.target_sku);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "key", &key_buf);

        ubufc_to_etlstr(key_buf, out.blob_req.key);

        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "STREAMREQ")) {
        out.type = MsgType::StreamRequest;
        new (&out.stream_request) MsgStreamRequest();
        out.live = true;

        UsefulBufC source_path_buf = NULLUsefulBufC;
        UsefulBufC dest_path_buf = NULLUsefulBufC;
        UsefulBufC dest_sku_buf = NULLUsefulBufC;
        uint64_t dest_udp_port_u64 = 0;
        double rate_hz_dbl = 0.0;

        QCBORDecode_GetTextStringInMapSZ(&ctx, "source_path", &source_path_buf);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "dest_path", &dest_path_buf);
        get_sku_in_map(&ctx, "dest_sku", out.stream_request.dest_sku);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "dest_udp_port", &dest_udp_port_u64);
        QCBORDecode_GetDoubleInMapSZ(&ctx, "rate_hz", &rate_hz_dbl);

        ubufc_to_etlstr(source_path_buf, out.stream_request.source_path);
        ubufc_to_etlstr(dest_path_buf, out.stream_request.dest_path);
        out.stream_request.dest_udp_port = static_cast<uint16_t>(dest_udp_port_u64);
        out.stream_request.rate_hz = static_cast<float>(rate_hz_dbl);
        QCBORDecode_GetAndResetError(&ctx);
        uint64_t sid = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "sid", &sid);
        if (QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS && sid <= 0x7FFF)
            out.stream_request.stream_id = static_cast<uint16_t>(sid);
        uint64_t conn[2] = {};
        if (decode_uint_array(&ctx, "conn", conn, 2) && conn[0]) {
            out.stream_request.conn.counter = static_cast<uint32_t>(conn[0]);
            out.stream_request.conn.origin  = static_cast<uint32_t>(conn[1]);
        }
        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "STREAMREPLY")) {
        out.type = MsgType::StreamReply;
        new (&out.stream_reply) MsgStreamReply();
        out.live = true;

        UsefulBufC source_path_buf = NULLUsefulBufC;
        UsefulBufC dest_path_buf = NULLUsefulBufC;
        uint64_t type_u64 = 0, mode_u64 = 0;
        QCBORDecode_GetTextStringInMapSZ(&ctx, "source_path", &source_path_buf);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "dest_path", &dest_path_buf);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "type", &type_u64);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "mode", &mode_u64);
        bool ok = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS &&
                  (type_u64 <= static_cast<uint8_t>(ParamType::Colour) ||
                   type_u64 == static_cast<uint8_t>(ParamType::Array)) &&
                  mode_u64 <= static_cast<uint8_t>(StreamMode::Polling);
        uint64_t of_u64 = 0, size_u64 = 0;
        if (ok && type_u64 == static_cast<uint8_t>(ParamType::Array)) {   // 9.3
            QCBORDecode_GetUInt64InMapSZ(&ctx, "of", &of_u64);
            QCBORDecode_GetUInt64InMapSZ(&ctx, "size", &size_u64);
            ok = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS && of_u64 <= 255 &&
                 known_elem(static_cast<uint8_t>(of_u64)) && size_u64 <= 65535;
        }

        auto& sr = out.stream_reply;
        ubufc_to_etlstr(source_path_buf, sr.source_path);
        ubufc_to_etlstr(dest_path_buf, sr.dest_path);
        if (ok) {
            sr.shape.type = static_cast<ParamType>(type_u64);
            sr.shape.mode = static_cast<StreamMode>(mode_u64);
            sr.shape.of = static_cast<ElemType>(of_u64);
            sr.shape.size = static_cast<uint16_t>(size_u64);
            const ParamType rt = sr.shape.type == ParamType::Array ? elem_scalar(sr.shape.of) : sr.shape.type;
            decode_range_value(&ctx, "min", rt, sr.shape.range_min);
            decode_range_value(&ctx, "max", rt, sr.shape.range_max);
            sr.shape.known = true;
        }
        QCBORDecode_GetAndResetError(&ctx);
        uint64_t id_u64 = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "id", &id_u64);
        if (QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS && id_u64 <= 0x7FFF)
            sr.stream_id = static_cast<uint16_t>(id_u64);

    } else if (str_eq(msg_buf, "TIME")) {
        out.type = MsgType::Time;
        new (&out.time) MsgTime();
        out.live = true;
        uint64_t t0 = 0, mesh = 0;
        QCBORDecode_GetUInt64InMapSZ(&ctx, "t0", &t0);
        QCBORDecode_GetAndResetError(&ctx);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "mesh", &mesh);
        out.time.reply = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS;
        out.time.t0 = static_cast<uint32_t>(t0);
        out.time.mesh = mesh;
        decode_clock(&ctx, out.time.clock);
        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "FIRE")) {
        out.type = MsgType::Fire;
        new (&out.fire) MsgFire();
        out.live = true;
        UsefulBufC source_path_buf = NULLUsefulBufC;
        UsefulBufC dest_path_buf = NULLUsefulBufC;
        QCBORDecode_GetTextStringInMapSZ(&ctx, "source_path", &source_path_buf);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "dest_path", &dest_path_buf);
        ubufc_to_etlstr(source_path_buf, out.fire.source_path);
        ubufc_to_etlstr(dest_path_buf, out.fire.dest_path);
        QCBORDecode_GetAndResetError(&ctx);
        uint64_t at = 0;                            // 9.3: absent from older nodes
        QCBORDecode_GetUInt64InMapSZ(&ctx, "at", &at);
        out.fire.at = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS ? at : 0;

    } else if (str_eq(msg_buf, "STREAMSTOP")) {
        out.type = MsgType::StreamStop;
        new (&out.stream_stop) MsgStreamStop();
        out.live = true;

        UsefulBufC source_path_buf = NULLUsefulBufC;
        UsefulBufC dest_path_buf = NULLUsefulBufC;
        UsefulBufC dest_sku_buf = NULLUsefulBufC;

        QCBORDecode_GetTextStringInMapSZ(&ctx, "source_path", &source_path_buf);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "dest_path", &dest_path_buf);
        get_sku_in_map(&ctx, "dest_sku", out.stream_stop.dest_sku);

        ubufc_to_etlstr(source_path_buf, out.stream_stop.source_path);
        ubufc_to_etlstr(dest_path_buf, out.stream_stop.dest_path);

        QCBORDecode_GetAndResetError(&ctx);

    } else if (str_eq(msg_buf, "CONNS")) {
        out.type = MsgType::Conns;
        new (&out.conns) MsgConns();
        out.live = true;

        uint64_t version = 0;
        get_sku_in_map(&ctx, "about", out.conns.about_sku);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "v", &version);
        if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS) return false;
        out.conns.version = static_cast<uint32_t>(version);
        if (!decode_connection_list(&ctx, out.conns.list)) return false;

    } else if (str_eq(msg_buf, "ENDED")) {
        out.type = MsgType::Ended;
        new (&out.ended) MsgEnded();
        out.live = true;
        UsefulBufC pop_buf = NULLUsefulBufC, why_buf = NULLUsefulBufC;
        uint64_t slot = 0;
        QCBORDecode_GetTextStringInMapSZ(&ctx, "pop", &pop_buf);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "slot", &slot);
        if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS || slot == 0 || slot > 255) return false;
        ubufc_to_etlstr(pop_buf, out.ended.source_path);
        out.ended.source_slot = static_cast<uint8_t>(slot);
        QCBORDecode_GetTextStringInMapSZ(&ctx, "why", &why_buf);
        if (QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS) {
            char tmp[16];
            out.ended.reason = parse_reason(ubufc_tmp(why_buf, tmp, sizeof(tmp)));
        }
        double id = 0;
        QCBORDecode_GetDoubleInMapSZ(&ctx, "id", &id);
        out.ended.has_instance = QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS;
        out.ended.instance = id;

    } else if (str_eq(msg_buf, "LINKEDIT")) {
        out.type = MsgType::LinkEdit;
        new (&out.link_edit) MsgLinkEdit();
        out.live = true;

        UsefulBufC dest_buf = NULLUsefulBufC;
        uint64_t what = 0;
        get_sku_in_map(&ctx, "dest", out.link_edit.dest_sku);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "w", &what);
        if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS) return false;
        out.link_edit.what = static_cast<uint8_t>(what);
        decode_connection_id(&ctx, out.link_edit.id);
        QCBORDecode_GetAndResetError(&ctx);
        bool got = false;
        QCBORDecode_EnterArrayFromMapSZ(&ctx, "l");
        if (QCBORDecode_GetAndResetError(&ctx) == QCBOR_SUCCESS) {
            for_each_map(&ctx, [&] { if (!got) got = decode_link(&ctx, out.link_edit.link); });
            QCBORDecode_ExitArray(&ctx);
            QCBORDecode_GetAndResetError(&ctx);
        }
        if (!got) return false;

    } else if (str_eq(msg_buf, "SCENE")) {
        out.type = MsgType::Scene;
        new (&out.scene) MsgScene();
        out.live = true;

        UsefulBufC op_buf = NULLUsefulBufC;
        uint64_t slot = 0, counter = 0, origin = 0;
        QCBORDecode_GetTextStringInMapSZ(&ctx, "op", &op_buf);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "slot", &slot);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "counter", &counter);
        QCBORDecode_GetUInt64InMapSZ(&ctx, "origin", &origin);
        if (QCBORDecode_GetAndResetError(&ctx) != QCBOR_SUCCESS ||
            slot == 0 || slot > 255 || counter == 0) {
            return false;
        }
        if (str_eq(op_buf, "recall"))     out.scene.op = SceneOp::Recall;
        else if (str_eq(op_buf, "store")) out.scene.op = SceneOp::Store;
        else return false;
        out.scene.slot          = static_cast<uint8_t>(slot);
        out.scene.stamp.counter = static_cast<uint32_t>(counter);
        out.scene.stamp.origin  = static_cast<uint32_t>(origin);

    } else if (str_eq(msg_buf, "DECLARE")) {
        // DECLARE needs full param tree decoding via decode_declare().
        // Return false so handle_message falls through to the DECLARE path.
        return false;

    } else {
        return false;
    }

    QCBORDecode_ExitMap(&ctx);

    // Don't treat trailing bytes as a fatal error
    QCBORError finish_err = QCBORDecode_Finish(&ctx);
    (void)finish_err;

    return true;
}

// ---------------------------------------------------------------------------
// decode_declare — full DECLARE decoder including param tree
// ---------------------------------------------------------------------------

// Set component `c` of a vector / colour range value.
static void set_range_component(ParamValueCore& out, ParamType type, int c, double d) {
    switch (type) {
        case ParamType::V2: out.v2[c] = static_cast<float>(d); break;
        case ParamType::V3: out.v3[c] = static_cast<float>(d); break;
        case ParamType::V4: out.v4[c] = static_cast<float>(d); break;
        case ParamType::Colour:
            out.rgba[c] = static_cast<uint8_t>(d < 0.0 ? 0.0 : d > 255.0 ? 255.0 : d);
            break;
        default: break;
    }
}

// Decode one bound of the range sub-map (key 10) for a param of `type`.
// Vectors and colours arrive as arrays; a plain number for a vector type is a
// range shared by every component (older encoders sent 0.0, other ports may
// send one scalar).
static void decode_range_value(QCBORDecodeContext* ctx, const char* key,
                               ParamType type, ParamValueCore& out) {
    out = ParamValueCore{};
    out.tag = type;

    QCBORItem item;
    QCBORDecode_GetItemInMapSZ(ctx, key, QCBOR_TYPE_ANY, &item);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) return;

    int count = 0; // components
    switch (type) {
        case ParamType::V2: count = 2; break;
        case ParamType::V3: count = 3; break;
        case ParamType::V4:
        case ParamType::Colour: count = 4; break;
        default: break;
    }

    if (item.uDataType == QCBOR_TYPE_ARRAY) {
        if (count == 0) return;
        QCBORDecode_EnterArrayFromMapSZ(ctx, key);
        for (int c = 0; c < count; ++c) {
            double d = 0.0;
            QCBORDecode_GetDoubleConvert(ctx, QCBOR_CONVERT_TYPE_FLOAT | QCBOR_CONVERT_TYPE_XINT64, &d);
            if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) break;
            set_range_component(out, type, c, d);
        }
        QCBORDecode_ExitArray(ctx);
        QCBORDecode_GetAndResetError(ctx);
        return;
    }

    double d = 0.0;
    switch (item.uDataType) {
        case QCBOR_TYPE_TRUE:   d = 1.0; break;
        case QCBOR_TYPE_FALSE:  d = 0.0; break;
        case QCBOR_TYPE_DOUBLE: d = item.val.dfnum; break;
        case QCBOR_TYPE_FLOAT:  d = static_cast<double>(item.val.fnum); break;
        case QCBOR_TYPE_INT64:  d = static_cast<double>(item.val.int64); break;
        case QCBOR_TYPE_UINT64: d = static_cast<double>(item.val.uint64); break;
        default: return;
    }
    if (type == ParamType::Bool) {
        out.b = d != 0.0;
    } else if (count == 0) {
        out.n = d;
    } else {
        for (int c = 0; c < count; ++c) set_range_component(out, type, c, d);
    }
}

// Decode a single param entry from an array item (protocol v2: integer keys + enum values).
template <typename Store>
static bool decode_one_param(QCBORDecodeContext* ctx, Store& store, size_t* dropped) {
    QCBORDecode_EnterMap(ctx, nullptr);

    // Key 1: path (text)
    UsefulBufC path_buf = NULLUsefulBufC;
    QCBORDecode_GetTextStringInMapN(ctx, 1, &path_buf);

    // Key 2-5, 7: integer enum values
    int64_t kind_val = 0, type_val = 0, mode_val = 0, flow_val = 0,
            access_val = static_cast<int64_t>(Access::ReadWrite);   // absent: the default
    QCBORDecode_GetInt64InMapN(ctx, 2, &kind_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 3, &type_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 4, &mode_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 5, &flow_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 7, &access_val);
    QCBORDecode_GetAndResetError(ctx);

    // Key 6: rate (double)
    double rate_val = 0.0;
    QCBORDecode_GetDoubleInMapN(ctx, 6, &rate_val);
    QCBORDecode_GetAndResetError(ctx);

    // Key 8: ground [up, down] in seconds (absent: the value stays)
    double ground_up_val = -1.0, ground_down_val = -1.0;
    QCBORDecode_EnterArrayFromMapN(ctx, 8);
    if (QCBORDecode_GetError(ctx) == QCBOR_SUCCESS) {
        QCBORDecode_GetDouble(ctx, &ground_up_val);
        QCBORDecode_GetDouble(ctx, &ground_down_val);
        QCBORDecode_ExitArray(ctx);
        if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) ground_up_val = ground_down_val = -1.0;
    } else {
        QCBORDecode_GetAndResetError(ctx);
    }

    // Key 9: hardware (bool)
    bool hardware_val = false;
    QCBORDecode_GetBoolInMapN(ctx, 9, &hardware_val);
    QCBORDecode_GetAndResetError(ctx);

    // Keys 25, 26: an array's element type and size (9.3)
    int64_t of_val = 0, size_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 25, &of_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 26, &size_val);
    QCBORDecode_GetAndResetError(ctx);
    const bool is_array = type_val == static_cast<int64_t>(ParamType::Array);
    const ElemType of = of_val >= 0 && known_elem(static_cast<uint8_t>(of_val > 255 ? 255 : of_val))
                      ? static_cast<ElemType>(of_val) : ElemType::Float;

    // Key 10: range sub-map, decoded according to the param type (key 3);
    // an array's is one element's
    const ParamType range_type = is_array ? elem_scalar(of) : static_cast<ParamType>(type_val);
    ParamValueCore range_min_val;
    ParamValueCore range_max_val;
    ParamValueCore range_init_val;
    QCBORDecode_EnterMapFromMapN(ctx, 10);
    if (QCBORDecode_GetError(ctx) == QCBOR_SUCCESS) {
        decode_range_value(ctx, "min", range_type, range_min_val);
        decode_range_value(ctx, "max", range_type, range_max_val);
        decode_range_value(ctx, "init", range_type, range_init_val);
        QCBORDecode_ExitMap(ctx);
    } else {
        QCBORDecode_GetAndResetError(ctx);
    }

    // Key 13: nature (integer enum)
    int64_t nature_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 13, &nature_val);
    QCBORDecode_GetAndResetError(ctx);

    // Key 17: topology (integer enum, optional — defaults to Span)
    int64_t topology_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 17, &topology_val);
    QCBORDecode_GetAndResetError(ctx);

    // Key 18: slots (optional — absent for all but poly groups)
    int64_t slots_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 18, &slots_val);
    QCBORDecode_GetAndResetError(ctx);
    // Keys 19, 20: role, full (optional, 9.1)
    int64_t role_val = 0, full_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 19, &role_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetInt64InMapN(ctx, 20, &full_val);
    QCBORDecode_GetAndResetError(ctx);
    int64_t grace_val = 0;
    double hold_val = -1.0;
    QCBORDecode_GetInt64InMapN(ctx, 21, &grace_val);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetDoubleInMapN(ctx, 22, &hold_val);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) hold_val = -1.0;
    bool every_val = false;
    QCBORDecode_GetBoolInMapN(ctx, 23, &every_val);
    if (QCBORDecode_GetAndResetError(ctx) != QCBOR_SUCCESS) every_val = false;
    int64_t ids_val = 0;
    QCBORDecode_GetInt64InMapN(ctx, 24, &ids_val);
    QCBORDecode_GetAndResetError(ctx);
    int64_t merge_val = 0;                          // key 27: merge (9.3, optional)
    QCBORDecode_GetInt64InMapN(ctx, 27, &merge_val);
    QCBORDecode_GetAndResetError(ctx);

    // Key 12, 14, 15: unit, label, desc (optional text — may be omitted by terse encoder)
    UsefulBufC unit_buf = NULLUsefulBufC;
    UsefulBufC label_buf = NULLUsefulBufC;
    UsefulBufC desc_buf = NULLUsefulBufC;
    QCBORDecode_GetTextStringInMapN(ctx, 12, &unit_buf);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetTextStringInMapN(ctx, 14, &label_buf);
    QCBORDecode_GetAndResetError(ctx);
    QCBORDecode_GetTextStringInMapN(ctx, 15, &desc_buf);
    QCBORDecode_GetAndResetError(ctx);

    // Key 16: subs array (optional)
    Vector<ParamSubscription> decoded_subs;
    QCBORDecode_EnterArrayFromMapN(ctx, 16);
    if (QCBORDecode_GetError(ctx) == QCBOR_SUCCESS) {
        while (true) {
            QCBORItem peek_item;
            QCBORDecode_VPeekNext(ctx, &peek_item);
            QCBORError peek_err = QCBORDecode_GetAndResetError(ctx);
            if (peek_err != QCBOR_SUCCESS || peek_item.uDataType != QCBOR_TYPE_MAP) {
                break;
            }
            QCBORDecode_EnterMap(ctx, nullptr);
            UsefulBufC sub_path_buf = NULLUsefulBufC;
            etl::string<36> sub_sku;
            get_sku_in_map(ctx, "sku", sub_sku);
            QCBORDecode_GetTextStringInMapSZ(ctx, "path", &sub_path_buf);
            QCBORDecode_ExitMap(ctx);

            if (!sub_sku.empty() && sub_path_buf.ptr && !decoded_subs.full()) {
                ParamSubscription sub;
                sub.source_sku = sub_sku;
                ubufc_to_etlstr(sub_path_buf, sub.source_path);
                decoded_subs.push_back(sub);
            }
        }
        QCBORDecode_ExitArray(ctx);
    } else {
        QCBORDecode_GetAndResetError(ctx);
    }

    QCBORDecode_ExitMap(ctx);

    QCBORError err = QCBORDecode_GetError(ctx);
    if (err != QCBOR_SUCCESS) {
        QCBORDecode_GetAndResetError(ctx);
    }

    // Build the ParamMeta from integer enum values
    ParamMeta meta;
    meta.kind   = static_cast<ParamKind>(kind_val);
    meta.type   = static_cast<ParamType>(type_val);
    meta.mode   = static_cast<StreamMode>(mode_val);
    meta.flow   = static_cast<FlowDir>(flow_val);
    meta.access = static_cast<Access>(access_val);
    meta.nature   = static_cast<Nature>(nature_val);
    meta.topology = static_cast<Topology>(topology_val);

    if (unit_buf.ptr)  ubufc_to_etlstr(unit_buf, meta.unit);
    if (label_buf.ptr) ubufc_to_etlstr(label_buf, meta.label);
    if (desc_buf.ptr)  ubufc_to_etlstr(desc_buf, meta.desc);

    meta.rate = static_cast<float>(rate_val);
    meta.ground_up = static_cast<float>(ground_up_val);
    meta.ground_down = static_cast<float>(ground_down_val);
    meta.hardware = hardware_val;
    meta.slots = static_cast<uint8_t>(slots_val < 0 ? 0 : slots_val > 255 ? 255 : slots_val);
    meta.role = role_val >= 1 && role_val <= static_cast<int64_t>(ParamRole::Confidence)
              ? static_cast<ParamRole>(role_val) : ParamRole::None;   // a later role: none here
    meta.grace_ms = static_cast<uint16_t>(grace_val < 0 ? 0 : grace_val > 65535 ? 65535 : grace_val);
    meta.hold = static_cast<float>(hold_val);
    meta.every = every_val;
    meta.ids = ids_val == 1 ? IdsMode::Source : IdsMode::Auto;
    meta.merge = merge_val == 1 ? MergeMode::Htp : merge_val == 2 ? MergeMode::Avg : MergeMode::Ltp;   // a later mode: LTP here
    meta.full = full_val == 1 ? FullPolicy::Refuse : full_val == 2 ? FullPolicy::Newest : FullPolicy::Steal;

    meta.range_min = range_min_val;
    meta.range_min.tag = range_type;
    meta.range_max = range_max_val;
    meta.range_max.tag = range_type;
    meta.range_init = range_init_val;
    meta.range_init.tag = range_type;
    if (is_array) {
        meta.of = of;
        meta.size = static_cast<uint16_t>(size_val < 0 ? 0 : size_val > 65535 ? 65535 : size_val);
    }

    // A param of a type this node doesn't know (a later one), or an array
    // it can't hold (an element type it doesn't know, no size): not
    // declared, the rest of the declaration read
    if (meta.kind != ParamKind::Group &&
        (type_val < 0 || type_val > static_cast<int64_t>(ParamType::Array) ||
         (is_array && (of_val < 0 || !known_elem(static_cast<uint8_t>(of_val > 255 ? 255 : of_val)) ||
                       !valid_array(meta.of, meta.size)))))
        return true;


    // The path, whole (Text: any length; out of memory, the param is dropped
    // rather than declared under a shorter path)
    Text path_str;
    if (path_buf.ptr) {
        ubufc_to_etlstr(path_buf, path_str);
        if (path_str.size() != path_buf.len) {
            if (dropped) ++*dropped;
            return true;
        }
    }

    // Insert into the store (a slim one keeps the ParamMetaCore part)
    typename Store::NodeType* declared = nullptr;
    if (meta.kind == ParamKind::Group) {
        declared = store.declare_group(path_str.c_str(), meta);
    } else {
        declared = store.declare_param(path_str.c_str(), meta);
    }
    if (!declared && dropped) ++*dropped;
    if (declared && meta.kind == ParamKind::Param && !readable(meta.access))
        declared->value.unknown = true;   // its value is never shown

    // Copy decoded subscriptions to the ParamNode
    if (declared && !decoded_subs.empty()) {
        declared->subscriptions = decoded_subs;
    }

    return true;
}

// Opens the DECLARE map and reads everything before "params". False if it
// is not a DECLARE.
static bool open_declare(QCBORDecodeContext* ctx, etl::span<const uint8_t> data,
                         uint32_t& seq, MsgDeclare& msg) {
    QCBORDecode_Init(ctx, UsefulBufC{data.data(), data.size()}, QCBOR_DECODE_MODE_NORMAL);
    QCBORDecode_EnterMap(ctx, nullptr);

    // Read common header
    UsefulBufC msg_buf = NULLUsefulBufC;
    uint64_t seq_u64 = 0;

    QCBORDecode_GetTextStringInMapSZ(ctx, "msg", &msg_buf);
    QCBORDecode_GetUInt64InMapSZ(ctx, "seq", &seq_u64);

    // Verify this is actually a DECLARE
    if (msg_buf.ptr == nullptr || !str_eq(msg_buf, "DECLARE")) {
        return false;
    }

    seq = static_cast<uint32_t>(seq_u64);

    // "about" field
    get_sku_in_map(ctx, "about", msg.about_sku);

    // "decl_version" field
    uint64_t decl_ver_u64 = 0;
    QCBORDecode_GetUInt64InMapSZ(ctx, "decl_version", &decl_ver_u64);
    msg.decl_version = static_cast<uint32_t>(decl_ver_u64);

    // Reset any accumulated non-critical errors before identity
    QCBORDecode_GetAndResetError(ctx);

    // Decode identity
    decode_identity(ctx, msg.identity);
    QCBORDecode_GetAndResetError(ctx);

    decode_scene_status(ctx, msg.scene);
    QCBORDecode_GetAndResetError(ctx);
    UsefulBufC at_buf = NULLUsefulBufC;
    uint64_t at_port = 0;
    QCBORDecode_GetTextStringInMapSZ(ctx, "at_addr", &at_buf);
    QCBORDecode_GetUInt64InMapSZ(ctx, "at_port", &at_port);
    if (QCBORDecode_GetAndResetError(ctx) == QCBOR_SUCCESS && at_port > 0 && at_port <= 0xFFFF) {
        ubufc_to_etlstr(at_buf, msg.at_address);
        msg.at_port = static_cast<uint16_t>(at_port);
    }
    return true;
}

// A copy of `src` and its subtree at `path` (whose last segment names it)
// A slot made from the template: slot "1"'s label is its number, this one's
// is its own (a store without labels has nothing to change)
template <typename M>
static auto relabel(M& meta, const char* from, const char* to, int) -> decltype(meta.label, void()) {
    if (meta.label == from) meta.label = to;
}
template <typename M>
static void relabel(M&, const char*, const char*, long) {}

template <typename Store, typename NodeT>
static void clone_subtree(Store& store, const NodeT* src, const Text& path,
                          const char* name, size_t* dropped) {
    auto meta = src->meta;
    relabel(meta, src->meta.name.c_str(), name, 0);
    meta.name = name;
    NodeT* made = meta.kind == ParamKind::Group ? store.declare_group(path.c_str(), meta)
                                                : store.declare_param(path.c_str(), meta);
    if (!made) { if (dropped) ++*dropped; return; }
    for (size_t i = 0; i < src->children.size(); ++i) {
        const NodeT* c = src->children[i];
        Text p;
        if (!path_join(path.c_str(), c->meta.name.c_str(), p)) { if (dropped) ++*dropped; continue; }
        clone_subtree(store, c, p, c->meta.name.c_str(), dropped);
    }
}

// Poly groups arrive as a template (slot "1"): make the other slots
template <typename Store, typename NodeT>
static void expand_poly(Store& store, NodeT* node, const char* prefix, size_t* dropped) {
    for (size_t i = 0; i < node->children.size(); ++i) {
        NodeT* g = node->children[i];
        if (g->children.empty()) continue;
        Text path;
        if (!path_join(prefix, g->meta.name.c_str(), path)) { if (dropped) ++*dropped; continue; }
        expand_poly(store, g, path.c_str(), dropped);       // polys inside the template first
        if (g->meta.kind != ParamKind::Group || g->meta.slots == 0) continue;
        const NodeT* tmpl = nullptr;
        for (size_t s = 0; s < g->children.size(); ++s)
            if (g->children[s]->meta.name == "1") tmpl = g->children[s];
        if (!tmpl) continue;
        for (unsigned k = 2; k <= g->meta.slots; ++k) {
            char name[4];
            snprintf(name, sizeof(name), "%u", k);
            bool there = false;
            for (size_t s = 0; s < g->children.size() && !there; ++s)
                there = g->children[s]->meta.name == name;
            if (there) continue;
            Text p;
            if (!path_join(path.c_str(), name, p)) { if (dropped) ++*dropped; continue; }
            clone_subtree(store, tmpl, p, name, dropped);
        }
    }
}

template <typename Store>
static void decode_params_array(QCBORDecodeContext* ctx, Store& params, size_t* dropped) {
    QCBORDecode_EnterArrayFromMapSZ(ctx, "params");
    if (QCBORDecode_GetError(ctx) == QCBOR_SUCCESS) {
        // Iterate through param entries until the array ends
        while (true) {
            // Peek to see if the next item exists and is a map
            QCBORItem peek_item;
            QCBORDecode_VPeekNext(ctx, &peek_item);
            QCBORError peek_err = QCBORDecode_GetAndResetError(ctx);
            if (peek_err != QCBOR_SUCCESS) {
                break;
            }
            if (peek_item.uDataType != QCBOR_TYPE_MAP) {
                break;
            }

            decode_one_param(ctx, params, dropped);
        }
        QCBORDecode_ExitArray(ctx);
    } else {
        QCBORDecode_GetAndResetError(ctx);
    }

    QCBORDecode_ExitMap(ctx);
    QCBORError finish_err = QCBORDecode_Finish(ctx);
    (void)finish_err;
    expand_poly(params, params.root(), "", dropped);
}

bool decode_declare(etl::span<const uint8_t> data,
                    uint32_t& seq,
                    MsgDeclare& msg, DecodeParamStore& params) {
    QCBORDecodeContext ctx;
    if (!open_declare(&ctx, data, seq, msg)) return false;
    decode_params_array(&ctx, params, nullptr);
    return true;
}

bool decode_declare_header(etl::span<const uint8_t> data,
                           uint32_t& seq, MsgDeclare& msg) {
    QCBORDecodeContext ctx;
    return open_declare(&ctx, data, seq, msg);
}

template <typename Store>
bool decode_declare_params(etl::span<const uint8_t> data, Store& params, size_t* dropped) {
    QCBORDecodeContext ctx;
    uint32_t seq = 0;
    MsgDeclare msg;
    if (!open_declare(&ctx, data, seq, msg)) return false;
    decode_params_array(&ctx, params, dropped);
    return true;
}

template bool decode_declare_params<ParamStore>(etl::span<const uint8_t>, ParamStore&, size_t*);
template bool decode_declare_params<ParamStoreSlim>(etl::span<const uint8_t>, ParamStoreSlim&, size_t*);

// ---------------------------------------------------------------------------
// decode_blob — BLOB decoder including binary data payload
// ---------------------------------------------------------------------------

bool decode_blob(etl::span<const uint8_t> data,
                 uint32_t& seq,
                 MsgBlob& msg,
                 etl::span<uint8_t> data_buf, size_t& data_len) {
    QCBORDecodeContext ctx;
    QCBORDecode_Init(&ctx, UsefulBufC{data.data(), data.size()}, QCBOR_DECODE_MODE_NORMAL);
    QCBORDecode_EnterMap(&ctx, nullptr);

    // Decode header
    UsefulBufC msg_buf = NULLUsefulBufC;
    int64_t seq_val = 0;

    QCBORDecode_GetTextStringInMapSZ(&ctx, "msg", &msg_buf);
    QCBORDecode_GetInt64InMapSZ(&ctx, "seq", &seq_val);

    seq = static_cast<uint32_t>(seq_val);

    // Decode blob fields
    UsefulBufC target_buf = NULLUsefulBufC;
    UsefulBufC key_buf = NULLUsefulBufC;
    UsefulBufC blob_data_buf = NULLUsefulBufC;

    get_sku_in_map(&ctx, "target", msg.target_sku);
    QCBORDecode_GetTextStringInMapSZ(&ctx, "key", &key_buf);
    QCBORDecode_GetByteStringInMapSZ(&ctx, "data", &blob_data_buf);

    ubufc_to_etlstr(key_buf, msg.key);

    if (blob_data_buf.ptr && blob_data_buf.len <= data_buf.size()) {
        memcpy(data_buf.data(), blob_data_buf.ptr, blob_data_buf.len);
        data_len = blob_data_buf.len;
    } else {
        data_len = 0;
    }

    QCBORDecode_ExitMap(&ctx);
    QCBORError finish_err = QCBORDecode_Finish(&ctx);
    (void)finish_err;

    return data_len > 0;
}

} // namespace dataflou
