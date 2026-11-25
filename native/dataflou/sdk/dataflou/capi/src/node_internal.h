// node_internal.h — what the files of the C interface (include/dataflou_c.h)
// share: the node behind a df_node*, the value conversions, and the helpers
// that more than one file calls. Private to capi/src.
#pragma once

#include "dataflou_c.h"

#include "dataflou/dataflou.h"
#include "desktop/clock_std.h"
#include "desktop/storage_file.h"
#include "desktop/tcp_asio.h"
#include "desktop/udp_asio.h"
#include "desktop/mdns_platform.h" // Bonjour on Apple: no multicast entitlement, works in an app extension

#include <cstddef>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <utility>
#include <vector>

using namespace dataflou;

struct df_node {
    explicit df_node(const char* storage_dir) : storage(storage_dir) {}

    TcpAsio     tcp;
    UdpAsio     udp;
    ClockStd    clock;
    StorageFile storage;
    MdnsPlatform mdns;
    std::unique_ptr<Node> node;   // on the heap: the world view alone is megabytes

    std::string name, sku, product, universe;
    std::string config = "{}";    // the params, as given to df_node_load_json()
    bool      loaded = false;
    bool      started = false;
    df_log_fn log = nullptr;
    void*     log_context = nullptr;

    // Watched params: their last epoch, to report changes not made here
    struct Watch { std::string path; uint32_t epoch = 0; };
    std::vector<Watch> watches;
    df_change_fn on_change = nullptr;
    void*        change_context = nullptr;
    df_array_fn  on_array = nullptr;      // watched arrays' elements (API 0.6)
    void*        array_context = nullptr;
    df_peer_fn   on_peer = nullptr;
    void*        peer_context = nullptr;
    // Destinations: what was last reported for each, those the core said
    // changed, and when the counts were last looked at
    std::vector<std::pair<std::string, df_destination>> destinations;
    std::vector<std::string> destinations_changed;
    df_destination_fn on_destination = nullptr;
    void*        destination_context = nullptr;
    uint32_t     destination_size = 0;    // the host's sizeof(df_destination)
    uint64_t     destinations_counted_ms = 0;
    std::vector<std::string> seeds;     // host:port, before the node starts
    // An imported state's values not yet given to a param (it may be
    // declared after the start)
    std::vector<std::pair<std::string, std::string>> imported_values;
    df_instance_fn on_instance = nullptr;
    void*        instance_context = nullptr;
    uint32_t     instance_size = 0;       // the host's sizeof(df_instance)
    // The edges of this poll, given after the values and before the gates
    // (dataflou/node.h, InstanceCb); their strings kept
    struct Edge { Node::InstanceEvent e; std::string population, source_sku; };
    std::vector<Edge> edges, given;      // given: kept until the next ones
    df_ended_fn  on_ended = nullptr;
    void*        ended_context = nullptr;
    df_locate_fn on_locate = nullptr;
    void*        locate_context = nullptr;
    df_halt_fn   on_halt = nullptr;
    df_topology_fn on_topology = nullptr;
    void*        topology_context = nullptr;
    df_scene_fn  on_scene = nullptr;
    void*        scene_context = nullptr;
    void*        halt_context = nullptr;
    std::vector<std::pair<std::string, ParamValue>> samples;   // every-sample params, this poll
};

namespace df_internal {

template <size_t N>
void copy(char (&out)[N], const char* in) {
    std::snprintf(out, N, "%s", in ? in : "");
}

inline df_type to_c(ParamType type) {
    return type == ParamType::Array ? DF_ARRAY : static_cast<df_type>(type);
}

// A declared type: DF_ARRAY is the core's Array; DF_UNKNOWN is no type
inline ParamType type_from_c(df_type t) {
    if (t == DF_ARRAY) return ParamType::Array;
    if (t < DF_BOOL || t > DF_TRIGGER) return ParamType::Number;
    return static_cast<ParamType>(t);
}

static_assert(static_cast<int>(ElemType::Byte) == DF_ELEM_BYTE, "df_elem follows ElemType");

inline void to_c(const ParamValue& in, df_value* out) {
    *out = df_value{};
    out->type = to_c(in.tag);
    if (in.unknown) { out->type = DF_UNKNOWN; return; }
    switch (in.tag) {
    case ParamType::Array:  out->n = static_cast<double>(array_count(in)); break;   // df_get_array
    case ParamType::Bool:   out->b = in.b; break;
    case ParamType::Number: out->n = in.n; break;
    case ParamType::V2:     std::memcpy(out->v, in.v2, sizeof(in.v2)); break;
    case ParamType::V3:     std::memcpy(out->v, in.v3, sizeof(in.v3)); break;
    case ParamType::V4:     std::memcpy(out->v, in.v4, sizeof(in.v4)); break;
    case ParamType::Colour: std::memcpy(out->rgba, in.rgba, sizeof(in.rgba)); break;
    case ParamType::String:
    case ParamType::Blob:   copy(out->s, in.s.c_str()); break;
    case ParamType::Trigger: out->n = in.n; break;   // fired that many times here
    }
}

inline ParamValue from_c(const df_value& in) {
    ParamValue v;
    if (in.type == DF_UNKNOWN) { v.unknown = true; return v; }   // its type: the param's
    v.tag = type_from_c(in.type);
    switch (v.tag) {
    case ParamType::Array:  break;   // its elements don't travel in a df_value (df_set_array)
    case ParamType::Bool:   v.b = in.b; break;
    case ParamType::Number:
    case ParamType::Trigger: v.n = in.n; break;
    case ParamType::V2: case ParamType::V3: case ParamType::V4:
        std::memcpy(v.v4, in.v, sizeof(in.v)); break;
    case ParamType::Colour: std::memcpy(v.rgba, in.rgba, sizeof(in.rgba)); break;
    case ParamType::String:
    case ParamType::Blob:   v.s = in.s; break;
    }
    return v;
}

// The node's config loaded into the core, under its identity (node.cpp)
bool load(df_node& n);

// An imported state's values, to the params that are there (one, if given)
// (state.cpp)
void give_imported(df_node& n, const char* path);

// Reports a destination if it changed since last time; all those under a
// group (connections.cpp)
void report_destination(df_node& n, const std::string& path, const ParamNode& p);
void report_destinations(df_node& n, const ParamNode* parent, const std::string& prefix);

// The poll's edges, in order (populations.cpp)
void give_edges(df_node& n);

// A watched param's value to the host: on_change, and an array's elements
// to on_array (node.cpp)
void give_value(df_node& n, const char* path, const ParamValue& value);

} // namespace df_internal
