// protocol.h — CBOR message codec for the dataflou TCP protocol.
//
// All messages are length-prefixed on the wire (4-byte big-endian uint32 header,
// then CBOR payload). This file defines the message structs and the
// encode/decode functions. QCBOR is used internally.
//
// Message types: Hello, Declare, Ack, Leave, Digest, Flush, Blob,
//                SubRequest, SetValue, ParamAdmin, Identify, Scene, Conns…
#pragma once

#include "dataflou/types.h"
#include "dataflou/world_view.h"
#include "dataflou/scene.h"
#include "dataflou/connection.h"
#include <etl/vector.h>
#include <etl/span.h>
#include <cstdint>

namespace dataflou {

// --- Message types ---

enum class MsgType : uint8_t {
    Hello, Declare, Ack, Leave, Digest, Flush, Blob, BlobReq, SubRequest, SetValue, ParamAdmin,
    StreamRequest, StreamStop, Conns, Identify, Scene, Phase, Detach, StreamReply, Fire,
    Time, LinkEdit, Ended, Halt, Locate
};

// What a node understands beyond its major (HELLO "feat", as names: a
// name a node doesn't know is ignored). 9.0 has them all; a 9.x adds names.
enum Feature : uint32_t {
    FeatStreamIds   = 1u << 0,   // "ids": stream packets format 3
    FeatStreamReply = 1u << 1,   // "reply": STREAMREPLY
    FeatFire        = 1u << 2,   // "fire": triggers over TCP
    FeatClock       = 1u << 3,   // "clock": TIME, mesh time
    FeatTimed       = 1u << 4,   // "timed" (9.3): stream entries of kind 10, values with their time
    // "editable" (9.3): its host applies an edit of a param's settings
    // from a page (PADMIN "update_fields": dataflou-node, the Mac app). A
    // host's to say, not the core's: Node::set_host_features.
    FeatEditable    = 1u << 5,
};
static constexpr uint32_t FEATURES_9_0 = FeatStreamIds | FeatStreamReply | FeatFire | FeatClock;
static constexpr uint32_t FEATURES_9_3 = FEATURES_9_0 | FeatTimed;
// The features a host may add to the core's
static constexpr uint32_t HOST_FEATURES = FeatEditable;
// A feature's name as HELLO says it (bit: one Feature); nullptr if none
const char* feature_name(uint32_t bit);

// The wire format; changes with the core's major (version.h), and once
// within one: 9.1 is 4, 9.0 was 3. A node talks to peers with the same one,
// and refuses the others at HELLO.
static constexpr uint8_t PROTO_VERSION = 4;

struct MsgHello {
    NodeIdentity identity;
    uint8_t      proto = PROTO_VERSION;
    uint16_t     listen_port = 0;
    WorldView::VersionVector versions;
    SceneCue     scene;          // the universe's current cue, as the sender knows it
    PhaseCue     phase;          // its phase (8.6; absent from older peers)
    HaltCue      halt;           // the mesh-wide stop, as it knows it (9.1)
    uint32_t     max_frame = 0;  // largest frame payload the sender takes (0: not said, before 8.2)
    NodeRole     role = NodeRole::Full;
    MemoryState  mem;
    uint32_t     features = 0;   // Feature bits (9.0)
    etl::string<32> universe;    // 9.0: a node dialled by address (a seed) may be in another
    ClockState   clock;
    WorldView::VersionVector conn_versions;   // "cv" (9.1): whose connection lists it holds
    // Key "auth" is reserved: a proof that the sender holds the universe's
    // key, when universes get one (permissions, not yet designed)
};

struct MsgDeclare {
    etl::string<36> about_sku;
    uint32_t        decl_version = 0;
    NodeIdentity    identity;
    SceneStatus     scene;
    // Where the sender reaches the node it declares, when it has a link to
    // it (9.0): without mDNS, how the others find it
    etl::string<46> at_address;
    uint16_t        at_port = 0;
    // params are encoded directly from/into a ParamStore
};

struct MsgAck {
    uint32_t ack_seq = 0;
};

struct MsgLeave {
    // from is implicit (in header)
};

// "Which one is this?": visualizers highlight the sender. No payload; from is the subject.
struct MsgIdentify {
};

// "I close this connection, and I am still here": a deliberate close (a
// connection limit, presentation) that the receiver must not take for the
// sender going offline. No payload. 8.6; older peers ignore it.
struct MsgDetach {
};

struct MsgDigest {
    WorldView::VersionVector versions;
    SceneCue scene;              // anti-entropy: a missed cue arrives within a digest
    PhaseCue phase;
    HaltCue  halt;               // (9.1)
    MemoryState mem;             // refreshed with each digest (9.0)
    ClockState  clock;
    WorldView::VersionVector conn_versions;   // "cv" (9.1)
};

// The mesh clock (9.0): a ping, and its answer with the replier's mesh time
struct MsgTime {
    bool       reply = false;
    uint32_t   t0 = 0;           // the pinger's own clock when it sent (echoed back)
    uint64_t   mesh = 0;         // reply: the replier's mesh time when it answered
    ClockState clock;            // reply: the replier's clock
};

// A scene cue: recall (the universe's current scene) or store (each node
// online saves its own connections). Forwarded once by each node it is new to.
struct MsgScene {
    SceneOp    op = SceneOp::Recall;
    uint8_t    slot = 0;
    SceneStamp stamp;
};

// The mesh-wide stop (9.1): forwarded once by each node it is new to.
struct MsgHalt {
    HaltCue cue;
};
// "Show where this param is" (9.1), to the node that has it: its host lights
// it, nudges it, flashes it, for `ms` (repeated while held; 0: stop)
struct MsgLocate {
    etl::string<36> target_sku;
    Text            path;
    uint32_t        ms = 0;
};
// The phase, set by a node: forwarded once by each node it is new to.
struct MsgPhase {
    PhaseCue cue;
};

struct MsgFlush {
    etl::string<36> target_sku;
};

struct MsgBlob {
    etl::string<36> target_sku;      // recipient node SKU
    etl::string<64> key;             // storage key (e.g. "atelier/source.lua")
    // Blob data is encoded/decoded separately (variable size, not in struct).
    // The codec reads/writes the data directly from/to caller-provided buffers.
};

struct MsgBlobReq {
    etl::string<36> target_sku;      // node that should send the blob back
    etl::string<64> key;             // storage key to read
};

struct MsgSubRequest {
    bool              subscribe = true; // true=subscribe, false=unsubscribe
    etl::string<36>   dest_sku;         // which node owns the destination param
    Text              dest_path;        // destination param path on that node
    etl::string<36>   source_sku;       // source node SKU
    Text              source_path;      // source param path
    ConnectionId      id;               // 9.0: made by the requester; 9.1: undoes by it alone
    Pick              pick;             // 9.1: one instance of the source's "*" level
};

struct MsgSetValue {
    etl::string<36>   target_sku;       // which node to set value on
    Text              path;             // param path ("lights/3": one element, 9.3)
    ParamValue        value;
    bool              unread = false;   // an array value this node does not read (9.3)
};

struct MsgParamAdmin {
    etl::string<36>   target_sku;
    etl::string<1024> payload;  // JSON: {"action":"update_fields"|"delete"|"add", ...}
};

struct MsgStreamRequest {
    Text             source_path;
    Text             dest_path;
    etl::string<36>  dest_sku;
    uint16_t         dest_udp_port = 0;
    float            rate_hz = 0.0f;
    // 9.1: the id its packets are to carry, chosen by the destination (it
    // knows from the start what they feed), and the connection they serve
    uint16_t         stream_id = 0;
    ConnectionId     conn;
};

struct MsgStreamStop {
    Text             source_path;
    Text             dest_path;
    etl::string<36>  dest_sku;
};

// A source's answer to a stream request (9.0): what its values are, so a
// destination maps them without the source's declaration (a satellite).
struct MsgStreamReply {
    Text             source_path;
    Text             dest_path;
    SourceShape      shape;
    uint16_t         stream_id = 0;    // the id its packets carry
};

// A trigger, to a destination over TCP (9.0): an event is not lost
struct MsgFire {
    Text             source_path;
    Text             dest_path;
    uint64_t         at = 0;      // 9.3, "at": the mesh time it fires at (0: on arrival)
};

// A node's connections (9.1), the whole list and its version: from the
// node itself when they change and to a peer that joins, relayed when a
// digest shows a peer behind. Replaces SUBANNOUNCE.
struct MsgConns {
    etl::string<36>  about_sku;
    uint32_t         version = 0;
    ConnectionList   list;
};

// An edit of one link of a connection (9.1), to its destination, which
// applies it and says its connections again
struct MsgLinkEdit {
    etl::string<36>  dest_sku;
    ConnectionId     id;
    Link             link;          // its dest names the link
    uint8_t          what = 0;      // LinkEdit bits
};

// A destination ended an instance of the receiver's population (9.1): its
// host closed it, its hold ran out, it gave way. To the source, which tells
// its host.
struct MsgEnded {
    Text             source_path;   // the receiver's population
    uint8_t          source_slot = 0;
    EndReason        reason = EndReason::None;
    bool             has_instance = false;
    double           instance = 0;
};

// --- Codec ---

// Encode a message into buf. Returns bytes written, or 0 on error.
// Who sends is said in HELLO only (9.1): after it, a connection's messages
// are from who its HELLO named. Skus travel as their 16 bytes when they are
// UUIDs in the usual form, as text otherwise.
size_t encode_hello(etl::span<uint8_t> buf,
                    uint32_t seq, const char* from_sku,
                    const MsgHello& msg);

size_t encode_declare(etl::span<uint8_t> buf,
                      uint32_t seq,
                      const MsgDeclare& msg, const ParamStore& params);

#ifdef DATAFLOU_SLIM_WORLDVIEW
size_t encode_declare(etl::span<uint8_t> buf,
                      uint32_t seq,
                      const MsgDeclare& msg, const ParamStoreSlim& params);
#endif

size_t encode_ack(etl::span<uint8_t> buf,
                  uint32_t seq,
                  const MsgAck& msg);

size_t encode_leave(etl::span<uint8_t> buf,
                    uint32_t seq);

size_t encode_identify(etl::span<uint8_t> buf,
                    uint32_t seq);

size_t encode_digest(etl::span<uint8_t> buf,
                     uint32_t seq,
                     const MsgDigest& msg);

size_t encode_flush(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgFlush& msg);

size_t encode_blob(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgBlob& msg,
                   etl::span<const uint8_t> data);

size_t encode_blob_req(etl::span<uint8_t> buf,
                       uint32_t seq,
                       const MsgBlobReq& msg);

size_t encode_sub_request(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgSubRequest& msg);

size_t encode_set_value(etl::span<uint8_t> buf,
                        uint32_t seq,
                        const MsgSetValue& msg);

size_t encode_param_admin(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgParamAdmin& msg);

size_t encode_stream_request(etl::span<uint8_t> buf,
                             uint32_t seq,
                             const MsgStreamRequest& msg);

size_t encode_stream_stop(etl::span<uint8_t> buf,
                          uint32_t seq,
                          const MsgStreamStop& msg);

size_t encode_stream_reply(etl::span<uint8_t> buf,
                           uint32_t seq,
                           const MsgStreamReply& msg);

size_t encode_time(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgTime& msg);

size_t encode_fire(etl::span<uint8_t> buf,
                   uint32_t seq,
                   const MsgFire& msg);

size_t encode_conns(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgConns& msg);

size_t encode_ended(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgEnded& msg);
size_t encode_link_edit(etl::span<uint8_t> buf,
                        uint32_t seq,
                        const MsgLinkEdit& msg);
size_t encode_scene(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgScene& msg);

size_t encode_detach(etl::span<uint8_t> buf, uint32_t seq);
size_t encode_halt(etl::span<uint8_t> buf, uint32_t seq, const MsgHalt& msg);
size_t encode_locate(etl::span<uint8_t> buf, uint32_t seq, const MsgLocate& msg);

size_t encode_phase(etl::span<uint8_t> buf,
                    uint32_t seq,
                    const MsgPhase& msg);

// Decode: returns the message type; fills the appropriate struct.
// seq is always populated; from_sku only for a HELLO (9.1: after it, the
// connection says who sends, and the node fills it in).
struct DecodedMsg {
    MsgType type;
    uint32_t seq = 0;
    etl::string<36> from_sku;
    union {
        MsgHello      hello;
        MsgAck        ack;
        MsgLeave      leave;
        MsgDigest     digest;
        MsgFlush      flush;
        MsgBlob       blob;
        MsgBlobReq    blob_req;
        MsgSubRequest    sub_request;
        MsgSetValue      set_value;
        MsgParamAdmin    param_admin;
        MsgStreamRequest stream_request;
        MsgStreamStop    stream_stop;
        MsgConns         conns;
        MsgLinkEdit      link_edit;
        MsgEnded         ended;
        MsgHalt          halt;
        MsgLocate        locate;
        MsgIdentify      identify;
        MsgScene         scene;
        MsgPhase         phase;
        MsgDetach        detach;
        MsgStreamReply   stream_reply;
        MsgFire          fire;
        MsgTime          time;
    };
    // MsgDeclare is handled separately (needs ParamStore)
    // MsgBlob data payload is handled separately (variable size)

    // decode_message constructs one member in place and sets `live`; the
    // destructor destroys it. (Before 8.6 every member held only fixed-size
    // data and an empty destructor did; a version vector or a long text
    // value now holds memory, which leaked with every HELLO and DIGEST.)
    bool live = false;

    DecodedMsg() : type(MsgType::Hello) {}
    DecodedMsg(const DecodedMsg&) = delete;
    DecodedMsg& operator=(const DecodedMsg&) = delete;
    ~DecodedMsg() {
        if (!live) return;
        switch (type) {
            case MsgType::Hello:         hello.~MsgHello(); break;
            case MsgType::Ack:           ack.~MsgAck(); break;
            case MsgType::Leave:         leave.~MsgLeave(); break;
            case MsgType::Digest:        digest.~MsgDigest(); break;
            case MsgType::Flush:         flush.~MsgFlush(); break;
            case MsgType::Blob:          blob.~MsgBlob(); break;
            case MsgType::BlobReq:       blob_req.~MsgBlobReq(); break;
            case MsgType::SubRequest:    sub_request.~MsgSubRequest(); break;
            case MsgType::SetValue:      set_value.~MsgSetValue(); break;
            case MsgType::ParamAdmin:    param_admin.~MsgParamAdmin(); break;
            case MsgType::StreamRequest: stream_request.~MsgStreamRequest(); break;
            case MsgType::StreamStop:    stream_stop.~MsgStreamStop(); break;
            case MsgType::Conns:         conns.~MsgConns(); break;
            case MsgType::LinkEdit:      link_edit.~MsgLinkEdit(); break;
            case MsgType::Ended:         ended.~MsgEnded(); break;
            case MsgType::Halt:          halt.~MsgHalt(); break;
            case MsgType::Locate:        locate.~MsgLocate(); break;
            case MsgType::Identify:      identify.~MsgIdentify(); break;
            case MsgType::Scene:         scene.~MsgScene(); break;
            case MsgType::Phase:         phase.~MsgPhase(); break;
            case MsgType::Detach:        detach.~MsgDetach(); break;
            case MsgType::StreamReply:   stream_reply.~MsgStreamReply(); break;
            case MsgType::Fire:          fire.~MsgFire(); break;
            case MsgType::Time:          time.~MsgTime(); break;
            case MsgType::Declare:       break;   // never in the union
        }
    }
};

bool decode_message(etl::span<const uint8_t> data, DecodedMsg& out);

// Decode a DECLARE message, populating the params store.
bool decode_declare(etl::span<const uint8_t> data,
                    uint32_t& seq,
                    MsgDeclare& msg, DecodeParamStore& params);

// A DECLARE in two steps: its header (sender, subject, version, identity,
// scene) without the params, to decide whether to take it; then its params,
// straight into the store that keeps them (full or slim). `dropped` counts
// the params that did not fit (out of memory).
bool decode_declare_header(etl::span<const uint8_t> data,
                           uint32_t& seq, MsgDeclare& msg);
template <typename Store>
bool decode_declare_params(etl::span<const uint8_t> data, Store& params, size_t* dropped = nullptr);

// Decode a BLOB message. Data payload is written to data_buf.
// data_len is set to the actual payload size on success.
bool decode_blob(etl::span<const uint8_t> data,
                 uint32_t& seq,
                 MsgBlob& msg,
                 etl::span<uint8_t> data_buf, size_t& data_len);

} // namespace dataflou
