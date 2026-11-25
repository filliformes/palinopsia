// types.h — Core enums, value types, and string converters for the dataflou mesh.
//
// Everything in this header is header-only. All enum-to-string and string-to-enum
// conversions live here so they are shared across protocol, config_loader, world_json,
// and the visualizer.
//
// Key types:  ParamType, ParamKind, StreamMode, FlowDir, Access, Nature, NodeState,
//             ParamValue (tagged union), ParamMeta (full param descriptor),
//             NodeIdentity, ParamSubscription.
#pragma once

#include "dataflou/config.h"
#include "dataflou/text.h"
#include <etl/string.h>
#include <etl/vector.h>
#include <cstdint>
#include <cstring>

namespace dataflou {

// --- Subscription ---

// A connection's identity (9.0): who made it (a hash of its creator's sku)
// and that creator's counter (its Lamport clock, as scene cues use). It
// holds while the connection lives, across dormancy, restarts and scenes.
struct ConnectionId {
    uint32_t counter = 0;   // 0: none (a connection from before 9.0)
    uint32_t origin  = 0;
    bool empty() const { return counter == 0; }
    bool operator==(const ConnectionId& o) const { return counter == o.counter && origin == o.origin; }
    bool operator!=(const ConnectionId& o) const { return !(*this == o); }
};


// --- Enums ---

// What a destination is doing (9.0, docs/couches.md "Trois machines
// d'état"): bound while a live connection feeds it; waiting when its last
// source went away, for a short grace; grounding while it returns to its
// init; free otherwise. Computed locally, never sent.
enum class DestState : uint8_t { Free, Bound, Waiting, Grounding };
// Where its last end came from: the source finished, the connection undid
// itself, the destination's host undid it, someone outside (a remote request,
// a scene), or nobody (the source's node is gone: lost).
enum class EndOrigin : uint8_t { None, Source, Connection, Destination, Outside, Lost };

inline const char* to_string(DestState s) {
    switch (s) {
        case DestState::Bound:     return "bound";
        case DestState::Waiting:   return "waiting";
        case DestState::Grounding: return "grounding";
        case DestState::Free:      return "free";
    }
    return "free";
}

inline const char* to_string(EndOrigin o) {
    switch (o) {
        case EndOrigin::Source:      return "source";
        case EndOrigin::Connection:  return "connection";
        case EndOrigin::Destination: return "destination";
        case EndOrigin::Outside:     return "outside";
        case EndOrigin::Lost:        return "lost";
        case EndOrigin::None:        return "";
    }
    return "";
}

enum class ParamKind  : uint8_t { Class, Group, Param };
enum class ParamType  : uint8_t { Bool, Number, String, V2, V3, V4, Blob, Colour, Trigger, Array };
// An array's elements (9.3, array.h): N values of one type. float, int
// (32 bits), bool, colour (RGBA) and byte (0..255, a DMX channel). On the wire
// its number; an element type a node doesn't know makes the value unread.
enum class ElemType   : uint8_t { Float, Int, Bool, Colour, Byte };
enum class FlowDir    : uint8_t { Source, Destination, Bidir };
enum class StreamMode : uint8_t { Streaming, Discrete, Polling };
enum class Access     : uint8_t { Read, Write, ReadWrite };
enum class Nature     : uint8_t { Lin, Log, Exp };
enum class Topology   : uint8_t { Span, Centered, Cyclic, Free };
// In a population's template (9.1), a param's part in an instance's life:
// its gate (a bool: open while it is on), its id (which instance), commit (a
// bool: the opening is tentative until it rises), reason (said as the gate
// falls: a text or an EndReason number), attack and release (the values its
// open and its release carry: a velocity), key (a re-identification key),
// parent (the id of the instance it belongs to: a touch's cluster), confidence
// (0..1, how sure its source is of it). An open set: a role a node doesn't
// know is no role to it.
enum class ParamRole  : uint8_t { None, Gate, Id, Commit, Reason, Attack, Release, Key, Parent, Confidence };
// Why an instance ended (9.1; docs/couches.md "Vies d'instances"), beside
// who ended it (EndOrigin). An open set; merge and split are kept for later.
enum class EndReason  : uint8_t { None, Done, Cancel, Lost, Steal, Failed, Merge, Split };
// A population (9.1): what a new instance does when every slot is taken.
// Steal: the oldest gives way to it; refuse: it is not taken; newest: the
// newest gives way. One in release gives way first, whatever the policy.
enum class FullPolicy : uint8_t { Steal, Refuse, Newest };
// Who gives a population's instances their id (9.1): the core, a counter per
// population (MPE notes, touches: the id says "this one" while it lives), or
// the source, whose ids mean something and are required (blob tracking: blob
// 3 is blob 3)
enum class IdsMode : uint8_t { Auto, Source };
// How a destination combines what several links feed it (9.3; docs/couches.md,
// "La fusion à la destination"): the last value wins (LTP, the default: as
// before 9.3), the highest (HTP: per channel for a colour, OR for a bool), or
// the average (per channel; per component for a vector; a bool is true when
// any is). A vector declared HTP, text, blobs and triggers are LTP whatever is
// declared (merge_of).
enum class MergeMode : uint8_t { Ltp, Htp, Avg };
// What a node takes part in. Full: everything. Source: it publishes its own params and serves their streams, nothing
// else: it keeps no world view of other nodes and subscribes to nothing, so
// peers send it no declarations and no digests (core 8.2). Satellite: it
// publishes and receives, so it holds connections, but of the world it
// keeps who is there (identities, online or not) and the params only of
// the nodes it listens to, and it relays nothing about others (core 8.6).
// Said in HELLO; older peers take an unknown role as Full.
enum class NodeRole : uint8_t { Full, Source, Satellite };

inline const char* to_string(NodeRole r) {
    switch (r) {
        case NodeRole::Source: return "source";
        case NodeRole::Satellite: return "satellite";
        case NodeRole::Full:   return "full";
    }
    return "full";
}

inline NodeRole parse_node_role(const char* s) {
    if (!s) return NodeRole::Full;
    if (strcmp(s, "source") == 0) return NodeRole::Source;
    if (strcmp(s, "satellite") == 0) return NodeRole::Satellite;
    return NodeRole::Full;
}

enum class NodeState  : uint8_t { Active, Idle, Disabled, Error };

// --- ParamValueCore: numeric-only tagged union (no string) ---
// Used for range values (min/max/init) which are always numeric.

struct ParamValue; // forward declaration

struct ParamValueCore {
    ParamType tag = ParamType::Number;
    union {
        bool     b;
        double   n;
        float    v2[2];
        float    v3[3];
        float    v4[4];
        uint8_t  rgba[4]; // Colour (R, G, B, A)
    };
    ParamValueCore() : v4{} {} // v4 spans the whole union: zero every byte
    inline ParamValueCore(const ParamValue& v);
};

// A node's mesh clock as it tells it: the reference it follows (a node's
// sku hash; the lowest one synced wins) and whether it has synced yet.
struct ClockState {
    uint32_t ref = 0;
    bool     synced = false;
};

// A node's memory as it tells it (HELLO, DIGEST; 9.0): what the core uses,
// and the room left under its budget and the heap's floor.
struct MemoryState {
    uint32_t used = 0;              // 0: not said
    uint32_t room = UINT32_MAX;     // UINT32_MAX: no limit
    bool said() const { return used != 0; }
};

// What a source's values are, as its stream reply says (9.0): enough to map
// them when the world view doesn't hold the source's declaration.
struct SourceShape {
    bool           known = false;
    ParamType      type  = ParamType::Number;
    StreamMode     mode  = StreamMode::Discrete;
    ElemType       of    = ElemType::Float;   // an array's (9.3); its range is one element's
    uint16_t       size  = 0;
    ParamValueCore range_min;
    ParamValueCore range_max;
};

// What feeds a destination param: one link of a connection (connection.h),
// as the param sees it. Made from the connections, never kept on its own.
struct ParamSubscription {
    etl::string<36>  source_sku;   // SKU of remote node
    Text             source_path;  // path on that node
    ConnectionId     id;           // the connection's
    // Where it comes from in the node's connection list (until the next
    // change of it): the connection and its link
    static constexpr uint16_t NONE = 0xFFFF;
    uint16_t         conn = NONE, link = NONE;
};

// --- ParamValue: tagged union ---

struct ParamValue {
    ParamType tag = ParamType::Number;
    // 9.1: no value is known (null): not absent, not unsupported; its type
    // is kept. On the wire, an entry with no value.
    bool      unknown = false;
    // An array's (9.3): its element type; its elements are in `s`, packed
    // (array.h). The count is s.size() / elem_size(of).
    ElemType  of = ElemType::Float;
    union {
        bool     b;
        double   n;
        float    v2[2];
        float    v3[3];
        float    v4[4];
        uint8_t  rgba[4]; // Colour (R, G, B, A)
    };
    Text s; // String and Blob: 15 characters inline, longer allocated; an array's elements

    ParamValue() : v4{} {} // v4 spans the whole union: zero every byte
    ParamValue(const ParamValueCore& c) : tag(c.tag), n(0.0) {
        std::memcpy(&n, &c.n, sizeof(v4));
    }
};

// A trigger's value is how many times it fired here (not sent: each
// firing is the event)
inline void fire_into(ParamValue& v) {
    const double count = v.tag == ParamType::Trigger ? v.n : 0.0;
    v.tag = ParamType::Trigger;
    v.n = count + 1.0;
}

inline ParamValueCore::ParamValueCore(const ParamValue& v) : tag(v.tag), n(0.0) {
    std::memcpy(&n, &v.n, sizeof(v4));
}

// --- ParamMetaCore: operational fields only (~114 bytes) ---
// Used for slim (remote/embedded) param nodes.

struct ParamMetaCore {
    Text       name;            // tree key (path segment), no spaces allowed
    ParamKind  kind   = ParamKind::Param;
    ParamType  type   = ParamType::Number;
    StreamMode mode   = StreamMode::Discrete;
    FlowDir    flow   = FlowDir::Source;
    // Who may set it besides its node: readwrite (the default) anyone; read
    // no one (a remote set is refused, 9.2); write anyone, but its value
    // never leaves the node
    Access     access = Access::ReadWrite;
    Nature     nature = Nature::Lin;
    Topology   topology = Topology::Span;
    float      rate   = 0.0f;
    // ground (9.0): when a destination stops being fed, it returns to its
    // init in ground_up seconds when its value is below init, ground_down
    // when above (0: at once). Negative: it keeps its value (the default).
    // The ramp is straight in the param's nature (a log param ramps in log).
    float      ground_up   = -1.0f;
    float      ground_down = -1.0f;
    bool       grounds() const { return ground_up >= 0.0f || ground_down >= 0.0f; }
    bool       hardware = false;
    // A group that is a population (poly): how many slots it has. Its
    // children are then the slots, groups named "1" … "N", all alike.
    // 0: an ordinary group or param. Core 8.5.
    uint8_t    slots    = 0;
    ParamRole  role     = ParamRole::None;      // in a population's template (9.1)
    FullPolicy full     = FullPolicy::Steal;    // a population's (9.1)
    // 9.1: every sample written counts (a stream: coalesced touches, a
    // gesture's trace), not only the last; sent and delivered in order
    bool       every    = false;
    IdsMode    ids      = IdsMode::Auto;        // a population's (9.1)
    // An array (9.3): its element type and its fixed size; its range is one
    // element's (range_* are of the element's scalar type, array.h)
    ElemType   of       = ElemType::Float;
    uint16_t   size     = 0;
    uint16_t   grace_ms = 0;                    // a population's: its lost instances wait (0: the node's)
    float      hold     = -1.0f;                // a population's release held, s (0: until its host closes; <0: not held)
    MergeMode  merge    = MergeMode::Ltp;       // a destination's, as declared (9.3; merge_of: as applied)
    ParamValueCore range_min;
    ParamValueCore range_max;
    ParamValueCore range_init;
};

// --- ParamMeta: full metadata including UI fields (~394 bytes) ---
// Inherits operational fields from ParamMetaCore.

struct ParamMeta : ParamMetaCore {
    // Text: what each holds, 15 characters inline, longer allocated
    Text uuid;
    Text label;      // human-readable display name
    Text desc;
    Text gui_hint;
    Text inherits;   // class name, empty if none
    Text unit;
};

// --- Node identity ---

struct NodeIdentity {
    etl::string<36> sku;     // UUID, immutable product ID
    Text            label;   // mutable, user-facing
    Text            product; // product name
    uint32_t        version = 0;
    NodeState       state   = NodeState::Active;
};

// --- Enum to string ---

inline const char* to_string(ParamKind k) {
    switch (k) {
        case ParamKind::Class: return "class";
        case ParamKind::Group: return "group";
        case ParamKind::Param: return "param";
    }
    return "param";
}

inline const char* to_string(ParamType t) {
    switch (t) {
        case ParamType::Bool:   return "bool";
        case ParamType::Number: return "number";
        case ParamType::String: return "string";
        case ParamType::V2:     return "v2";
        case ParamType::V3:     return "v3";
        case ParamType::V4:     return "v4";
        case ParamType::Blob:   return "blob";
        case ParamType::Colour: return "colour";
        case ParamType::Trigger: return "trigger";
        case ParamType::Array:  return "array";
    }
    return "number";
}

inline const char* to_string(ElemType t) {
    switch (t) {
        case ElemType::Float:  return "float";
        case ElemType::Int:    return "int";
        case ElemType::Bool:   return "bool";
        case ElemType::Colour: return "colour";
        case ElemType::Byte:   return "byte";
    }
    return "float";
}

inline const char* to_string(StreamMode m) {
    switch (m) {
        case StreamMode::Streaming: return "streaming";
        case StreamMode::Discrete:  return "discrete";
        case StreamMode::Polling:   return "polling";
    }
    return "discrete";
}

inline const char* to_string(FlowDir f) {
    switch (f) {
        case FlowDir::Source:      return "source";
        case FlowDir::Destination: return "destination";
        case FlowDir::Bidir:       return "bidir";
    }
    return "source";
}

inline const char* to_string(Access a) {
    switch (a) {
        case Access::Read:      return "read";
        case Access::Write:     return "write";
        case Access::ReadWrite: return "readwrite";
    }
    return "read";
}

// A write-only param (a password, a command) keeps its value on its node:
// never streamed, monitored, declared or shown in a world view (9.2)
inline bool readable(Access a) { return a != Access::Write; }

inline const char* to_string(Nature n) {
    switch (n) {
        case Nature::Lin: return "lin";
        case Nature::Log: return "log";
        case Nature::Exp: return "exp";
    }
    return "lin";
}

inline const char* to_string(Topology t) {
    switch (t) {
        case Topology::Span:     return "span";
        case Topology::Centered: return "centered";
        case Topology::Cyclic:   return "cyclic";
        case Topology::Free:     return "free";
    }
    return "span";
}

inline const char* to_string(ParamRole r) {
    switch (r) {
        case ParamRole::None:    return "";
        case ParamRole::Gate:    return "gate";
        case ParamRole::Id:      return "id";
        case ParamRole::Commit:  return "commit";
        case ParamRole::Reason:  return "reason";
        case ParamRole::Attack:  return "attack";
        case ParamRole::Release: return "release";
        case ParamRole::Key:     return "key";
        case ParamRole::Parent:  return "parent";
        case ParamRole::Confidence: return "confidence";
    }
    return "";
}

inline const char* to_string(EndReason r) {
    switch (r) {
        case EndReason::None:   return "";
        case EndReason::Done:   return "done";
        case EndReason::Cancel: return "cancel";
        case EndReason::Lost:   return "lost";
        case EndReason::Steal:  return "steal";
        case EndReason::Failed: return "failed";
        case EndReason::Merge:  return "merge";
        case EndReason::Split:  return "split";
    }
    return "";
}

inline const char* to_string(FullPolicy f) {
    return f == FullPolicy::Refuse ? "refuse" : f == FullPolicy::Newest ? "newest" : "steal";
}

inline const char* to_string(NodeState s) {
    switch (s) {
        case NodeState::Active:   return "active";
        case NodeState::Idle:     return "idle";
        case NodeState::Disabled: return "disabled";
        case NodeState::Error:    return "error";
    }
    return "active";
}

// --- String to enum ---

inline ParamKind parse_param_kind(const char* s) {
    if (!s) return ParamKind::Param;
    if (strcmp(s, "class") == 0) return ParamKind::Class;
    if (strcmp(s, "group") == 0) return ParamKind::Group;
    return ParamKind::Param;
}

inline ParamType parse_param_type(const char* s) {
    if (!s) return ParamType::Number;
    if (strcmp(s, "bool")   == 0) return ParamType::Bool;
    if (strcmp(s, "number") == 0) return ParamType::Number;
    if (strcmp(s, "string") == 0) return ParamType::String;
    if (strcmp(s, "v2")     == 0) return ParamType::V2;
    if (strcmp(s, "v3")     == 0) return ParamType::V3;
    if (strcmp(s, "v4")     == 0) return ParamType::V4;
    if (strcmp(s, "blob")   == 0) return ParamType::Blob;
    if (strcmp(s, "colour") == 0) return ParamType::Colour;
    if (strcmp(s, "trigger") == 0) return ParamType::Trigger;
    if (strcmp(s, "array")  == 0) return ParamType::Array;
    return ParamType::Number;
}

// An array's element type by name; false if it is none
inline bool parse_elem_type(const char* s, ElemType& out) {
    if (!s) return false;
    for (uint8_t i = 0; i <= static_cast<uint8_t>(ElemType::Byte); ++i)
        if (strcmp(s, to_string(static_cast<ElemType>(i))) == 0) { out = static_cast<ElemType>(i); return true; }
    if (strcmp(s, "number") == 0) { out = ElemType::Float; return true; }
    return false;
}

inline StreamMode parse_stream_mode(const char* s) {
    if (!s) return StreamMode::Discrete;
    if (strcmp(s, "streaming") == 0) return StreamMode::Streaming;
    if (strcmp(s, "discrete")  == 0) return StreamMode::Discrete;
    if (strcmp(s, "polling")   == 0) return StreamMode::Polling;
    return StreamMode::Discrete;
}

inline FlowDir parse_flow_dir(const char* s) {
    if (!s) return FlowDir::Source;
    if (strcmp(s, "source")      == 0) return FlowDir::Source;
    if (strcmp(s, "destination") == 0) return FlowDir::Destination;
    if (strcmp(s, "bidir")       == 0) return FlowDir::Bidir;
    return FlowDir::Source;
}

// Absent or unknown: readwrite, the default (read only when said)
inline Access parse_access(const char* s) {
    if (!s) return Access::ReadWrite;
    if (strcmp(s, "read")      == 0) return Access::Read;
    if (strcmp(s, "write")     == 0) return Access::Write;
    if (strcmp(s, "readwrite") == 0) return Access::ReadWrite;
    if (strcmp(s, "rw")        == 0) return Access::ReadWrite;
    return Access::ReadWrite;
}

inline Nature parse_nature(const char* s) {
    if (!s) return Nature::Lin;
    if (strcmp(s, "lin") == 0) return Nature::Lin;
    if (strcmp(s, "log") == 0) return Nature::Log;
    if (strcmp(s, "exp") == 0) return Nature::Exp;
    return Nature::Lin;
}

inline Topology parse_topology(const char* s) {
    if (!s) return Topology::Span;
    if (strcmp(s, "span")     == 0) return Topology::Span;
    if (strcmp(s, "centered") == 0) return Topology::Centered;
    if (strcmp(s, "cyclic")   == 0) return Topology::Cyclic;
    if (strcmp(s, "free")     == 0) return Topology::Free;
    return Topology::Span;
}

inline ParamRole parse_role(const char* s) {
    if (!s) return ParamRole::None;
    for (uint8_t i = 1; i <= static_cast<uint8_t>(ParamRole::Confidence); ++i)
        if (strcmp(s, to_string(static_cast<ParamRole>(i))) == 0) return static_cast<ParamRole>(i);
    return ParamRole::None;
}

inline EndReason parse_reason(const char* s) {
    if (!s) return EndReason::None;
    for (uint8_t i = 1; i <= static_cast<uint8_t>(EndReason::Split); ++i)
        if (strcmp(s, to_string(static_cast<EndReason>(i))) == 0) return static_cast<EndReason>(i);
    return EndReason::None;
}

inline const char* to_string(IdsMode m) { return m == IdsMode::Source ? "source" : "auto"; }
inline IdsMode parse_ids(const char* s) {
    return s && strcmp(s, "source") == 0 ? IdsMode::Source : IdsMode::Auto;
}

inline const char* to_string(MergeMode m) {
    return m == MergeMode::Htp ? "htp" : m == MergeMode::Avg ? "avg" : "ltp";
}
inline MergeMode parse_merge(const char* s) {
    if (s && strcmp(s, "htp") == 0) return MergeMode::Htp;
    if (s && strcmp(s, "avg") == 0) return MergeMode::Avg;
    return MergeMode::Ltp;
}

// The merge a destination applies: its declared mode where its type has one
// (numbers, colours, bools, and arrays, whose elements are all of these:
// element by element, by the element type's rule; vectors average, per
// component, but have no highest), LTP for the rest.
inline MergeMode merge_of(const ParamMetaCore& m) {
    switch (m.type) {
    case ParamType::Number:
    case ParamType::Colour:
    case ParamType::Bool:
    case ParamType::Array:  return m.merge;
    case ParamType::V2:
    case ParamType::V3:
    case ParamType::V4:     return m.merge == MergeMode::Avg ? MergeMode::Avg : MergeMode::Ltp;
    default:                return MergeMode::Ltp;
    }
}

inline FullPolicy parse_full(const char* s) {
    if (s && strcmp(s, "refuse") == 0) return FullPolicy::Refuse;
    if (s && strcmp(s, "newest") == 0) return FullPolicy::Newest;
    return FullPolicy::Steal;
}

inline NodeState parse_node_state(const char* s) {
    if (!s) return NodeState::Active;
    if (strcmp(s, "active")   == 0) return NodeState::Active;
    if (strcmp(s, "idle")     == 0) return NodeState::Idle;
    if (strcmp(s, "disabled") == 0) return NodeState::Disabled;
    if (strcmp(s, "error")    == 0) return NodeState::Error;
    return NodeState::Active;
}

} // namespace dataflou
