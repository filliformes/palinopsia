// node.h — Central Node class: one instance per device in the dataflou mesh.
//
// Node owns the local ParamStore, a WorldView of all peers, and drives the
// TCP/mDNS/UDP networking via tick-driven poll(). Single-threaded; no locks.
//
// Lifecycle: construct -> load_json/load_json_file -> start -> poll in loop -> stop.
// Remote operations return expected<void, Error>.
#pragma once

#include "dataflou/types.h"
#include "dataflou/param.h"
#include "dataflou/world_view.h"
#include "dataflou/scene.h"
#include "dataflou/connection.h"
#include "dataflou/pal.h"
#include "dataflou/compat.h"
#include "dataflou/memory.h"
#include <etl/string.h>
#include <etl/span.h>

// What the node holds (peers, params, the world view, connections) grows as
// needed, from the core's memory and within its budget (memory.h). What stays
// fixed belongs to the protocol:
//
// The largest frame taken from a peer (4-byte length included); a peer's
// receive buffer is made at each frame's size, up to it. Said in HELLO
// (max_frame). 4 MB on a computer: a declaration of thousands of params
// (an app mirrored through OSCQuery); a board says less (config.h).
#ifndef DATAFLOU_RECV_BUF_SIZE
#define DATAFLOU_RECV_BUF_SIZE (4u * 1024 * 1024)
#endif
// The largest frame this node encodes: its encode buffer starts at 1 KB and
// grows on demand up to this, back to 1 KB once a big message has gone.
#ifndef DATAFLOU_MAX_MSG_BUF
#define DATAFLOU_MAX_MSG_BUF (4u * 1024 * 1024)
#endif
// A UDP stream datagram: under an Ethernet frame (1472 bytes of UDP), so a
// DMX universe (512 bytes, and its entry) goes in one.
#ifndef DATAFLOU_UDP_BUF_SIZE
#define DATAFLOU_UDP_BUF_SIZE 1400
#endif
// A node built only to publish (a sensor): starts with role Source (see
// NodeRole in types.h) whatever its config says.
// #define DATAFLOU_SOURCE_ONLY

namespace dataflou {

struct MsgScene;
struct MsgTime;
struct MsgLocate;

enum class Error : uint8_t {
    ParseFailed, NotFound, Full, TypeMismatch, NotConnected,
    ReadOnly                     // a remote set of a param declared `read` (9.2)
};

// A Node object is small: what it holds is allocated from the core's memory
// as it comes (memory.h). A budget, if any, is set before constructing it.
class Node {
public:
    Node(ITcp& tcp, IMdns& mdns, IClock& clock, IStorage& storage, IUdp& udp);

    // --- Config loading ---
    expected<void, Error> load_json(const char* json_string);
    expected<void, Error> load_json_file(const char* path);

    // --- Universe ---
    void set_universe(const char* name);
    const etl::string<32>& universe() const { return universe_; }

    // --- Role --- (before start(); also "role": "source" in the config)
    void set_role(NodeRole role);
    NodeRole role() const { return role_; }

    // --- Features --- (before start(): HELLO says them)
    // What the host adds to the core's (protocol.h HOST_FEATURES, e.g.
    // FeatEditable: it applies a page's edit of a param's settings)
    void set_host_features(uint32_t f);
    // The Feature bits this node's HELLO says
    uint32_t features() const;
    // The Feature bits a peer's HELLO said; 0 without a direct link to it
    // (a node known through another says nothing of its features)
    uint32_t peer_features(const char* sku) const;

    // Universes other nodes on this network were seen in (by mDNS), this one
    // aside: what a scanner would list. A universe leaves it with its last
    // node: when mDNS says it went, or (a backend that asks every 15 s and
    // says no goodbye) when none of its nodes was heard of for 45 s.
    const Vector<etl::string<32>>& universes_seen() const { return universes_seen_; }

    // Largest frame payload this node takes from a peer; said in HELLO so
    // peers don't send bigger ones. Bigger frames are skipped, not fatal.
    static constexpr uint32_t max_frame() { return DATAFLOU_RECV_BUF_SIZE - 4; }
    // This node's memory, as HELLO and DIGEST tell it
    static MemoryState memory_state() {
        MemoryState m;
        m.used = static_cast<uint32_t>(Memory::used() < UINT32_MAX ? Memory::used() : UINT32_MAX - 1);
        if (!m.used) m.used = 1;                         // said, even before the first allocation
        const size_t r = Memory::room();
        m.room = r < UINT32_MAX ? static_cast<uint32_t>(r) : UINT32_MAX;
        return m;
    }

    // --- Lifecycle ---
    void start();
    void poll();
    void stop();

    // --- Dynamic param declaration ---
    ParamNode* declare_group(const char* path, const ParamMeta& meta);
    ParamNode* declare_param(const char* path, const ParamMeta& meta);
    // Many declarations said once (9.3): between hold_declarations() and
    // release_declarations(), declare_param, declare_group and remove_param
    // change the local tree only; the last release says it to the mesh in
    // one DECLARE (and relinks once), if anything changed. A declaration
    // through Node is otherwise said to every peer each time: thousands of
    // them (an app's namespace) would be quadratic. Holds nest.
    void hold_declarations() { ++decl_hold_; }
    void release_declarations();
    bool declarations_held() const { return decl_hold_ > 0; }

    // --- Local parameter access ---
    void              set_value(const char* path, const ParamValue& val);
    const ParamValue* get_value(const char* path) const;
    // A value that carries its time (9.3, docs/couches.md "Les valeurs
    // datées"): `at` is the mesh time (mesh_millis()) it is true at, past
    // (a sensor read earlier) or ahead (a cue). It goes out with it; a
    // destination applies it at that time, holding it until then if it is
    // ahead (up to the hold horizon). 0: none, as set_value.
    void              set_value_at(const char* path, const ParamValue& val, uint64_t at);
    // The mesh time a param's value is true at, as its source stamped it;
    // 0: not stamped (true when it was written or arrived), or no such param
    uint64_t          value_time(const char* path) const;
    // How far ahead a stamped value is held (default 10 s); one stamped
    // further ahead is applied at once, and logged
    void              set_hold_horizon(uint64_t ms) { hold_horizon_ms_ = ms; }
    bool              remove_param(const char* path);

    // Remote value set: if target_sku is local, applies directly; otherwise forwards to peer.
    expected<void, Error> set_value_remote(const char* target_sku, const char* path, const ParamValue& val);

    // --- World view ---
    const WorldView& world() const { return world_; }

    // --- Admin ---
    void flush_node(const char* sku);

    // --- Forgetting ---
    // A satellite forgets an offline node on its own after a while (it comes
    // back with its HELLO); a full node forgets the offline node it heard
    // from longest ago when something new doesn't fit. This forgets every
    // offline node now: here only, or across the mesh (FLUSH, so a full
    // node's gossip doesn't bring it back). Returns how many.
    size_t forget_offline(bool mesh_wide);

    // --- Its state, to move it ---
    // What makes this node itself beyond its declaration lives in a few
    // storage records: its connections, its scenes, its phase pin, its
    // declaration count. save_state() writes them all now (a node not
    // started has nothing newer than its storage: it writes nothing); state_key(i)
    // names them (false past the last). Written into another node's
    // storage before it starts, under the same sku, they make it this node
    // (an export: desktop/state_json.h).
    void save_state();
    static bool state_key(size_t i, etl::string<16>& key);

    // Nodes seen on the network that speak another protocol (another core
    // major): not called, refused at HELLO, listed for the visualizer.
    struct IncompatibleNode {
        etl::string<36> sku;
        Text            label;
        uint8_t         core_major = 0;  // 0: unknown (refused at HELLO: its proto is known)
        uint8_t         proto = 0;       // 0: unknown (seen by mDNS only)
        uint64_t        last_ms = 0;
        etl::string<12> core_ver;        // "8.6", from its mDNS record
        etl::string<46> address;         // where it was seen
        uint16_t        port = 0;
        Text            product;         // from its HELLO
    };
    uint64_t millis_now() const { return clock_.millis(); }   // the age of last_ms
    const Vector<IncompatibleNode>& incompatible_nodes() const { return incompatible_; }

    // How long a satellite keeps an offline node (default 60 s).
    void set_forget_after(uint64_t ms) { forget_after_ms_ = ms; }

    // On a transport with few connections (ITcp::connection_limit, a
    // W5500's sockets), how long a new peer has to say what it wants before
    // it can be closed to keep one connection spare (default 15 s).
    void set_connection_grace(uint64_t ms) { connection_grace_ms_ = ms; }

    // What the node holds, one line per kind, for a log or a probe.
    void memory_report(void (*out)(const char* line, void* ctx), void* ctx) const;

    // --- Events ---
    using PeerCb       = void(*)(const NodeIdentity& peer, void* ctx);
    using TopologyCb   = void(*)(void* ctx);
    using LogCb        = void(*)(const char* msg, void* ctx);
    using ParamAdminCb = void(*)(const char* target_sku, const char* payload_json, void* ctx);
    using BlobCb       = void(*)(const char* key, const uint8_t* data, size_t len, void* ctx);
    // Returns true if blob was provided (writes data to buf, sets out_len)
    using BlobProviderCb = bool(*)(const char* key, uint8_t* buf, size_t buf_size, size_t& out_len, void* ctx);
    // A node asked to be highlighted (sku = that node, possibly this one)
    using IdentifyCb = void(*)(const char* sku, void* ctx);

    void on_peer_joined(PeerCb cb, void* ctx);
    void on_peer_left(PeerCb cb, void* ctx);
    void on_topology_changed(TopologyCb cb, void* ctx);
    void on_log(LogCb cb, void* ctx);
    void on_param_admin(ParamAdminCb cb, void* ctx);
    void on_blob(BlobCb cb, void* ctx);
    void on_blob_req(BlobProviderCb cb, void* ctx);
    void on_identify(IdentifyCb cb, void* ctx);

    // Ask every visualizer on the mesh (and our own) to highlight this node.
    void identify();

    expected<void, Error> send_param_admin(const char* target_sku, const char* payload_json);
    expected<void, Error> send_blob(const char* target_sku, const char* key,
                                    const uint8_t* data, size_t len);
    expected<void, Error> send_blob_req(const char* target_sku, const char* key);

    // --- Connections (connection.h) ---
    // A destination of ours (a param or a group) listens to a source (a
    // param or a group of the same shape). id: the connection's identity;
    // empty: a new one, made here. pick: which instance of a source
    // population, when the source path has a "*" level (connection.h);
    // made again with another pick, the connection picks anew.
    bool subscribe(const char* local_path, const char* source_sku, const char* source_path,
                   ConnectionId id = {}, const Pick& pick = {});
    // origin: who undid it (the destination's host by default; a remote
    // request or a scene is Outside), what the destination will say. Ends
    // that are one link of a group connection leave that link unfed.
    bool unsubscribe(const char* local_path, const char* source_sku, const char* source_path,
                     EndOrigin origin = EndOrigin::Destination);

    // A node of the world by its name (its label) or its sku: its sku, online
    // ones first; empty if none is there (yet)
    etl::string<36> find_sku(const char* name_or_sku) const;
    // One of this node's destinations listens to `source_path` on the node
    // `source`, by its name or its sku (a pick: one instance of a source
    // population). The source need not be on the mesh yet: the connection
    // is made at the first poll() after a node of that name appears, and is
    // then kept like any other. Asked again for the same ends, nothing more.
    void listen(const char* path, const char* source, const char* source_path, const Pick& pick = {});
    // What listen() made, undone, or no longer waited for
    bool stop_listening(const char* path, const char* source, const char* source_path);

    // --- Destinations (9.0) ---
    // What a destination of ours is doing (bound, waiting, grounding, free)
    // and where its last end came from. The callback fires on each change.
    DestState destination_state(const char* path, EndOrigin* origin = nullptr) const;
    // The same with what feeds it: its connections, and how many of their
    // sources are online. A population (9.1) answers as a whole: bound
    // while a source of its connections is there, lost when none is.
    struct Destination {
        DestState state = DestState::Free;
        EndOrigin origin = EndOrigin::None;
        int connections = 0;
        int live = 0;
    };
    Destination destination(const char* path) const;
    using DestCb = void(*)(const char* path, DestState state, EndOrigin origin, void* ctx);
    void on_destination(DestCb cb, void* ctx) { dest_cb_ = cb; dest_ctx_ = ctx; }
    // How long a destination waits for a source that went away before it
    // lets go (default 1 s)
    void set_destination_grace(uint64_t ms) { dest_grace_ms_ = ms; }

    // --- Populations (9.1, docs/couches.md "La connexion poly", "Vies d'instances") ---
    // A population of ours that listens to others' keeps a table: which
    // instance holds each of its slots. An instance opens when its gate
    // rises (or, without a gate, with its first value) and takes a slot (its
    // own number if free, else the first free, else by the population's
    // policy: one in release gives way, then the oldest; or it is refused).
    // Its life has four edges, each an event: open (tentative while its
    // commit param is down, when the template has one), commit, release (its
    // gate falls; a population with "release": "held" keeps the slot for the
    // resonance until its host closes it or its hold runs out), close (with
    // who ended it and why: source done, failed or what its reason param
    // says; destination steal or close; lost past the grace; cancel when its
    // connection goes).
    // Relate (9.1): its parent param changed, or the instance it named closed
    enum class Edge : uint8_t { Open, Commit, Release, Close, Relate };
    struct InstanceEvent {
        const char*  population = "";
        uint8_t      slot = 0;
        Edge         edge = Edge::Open;
        bool         open = false;               // the slot is taken (open, or released and held)
        bool         tentative = false;          // not committed yet
        bool         released = false;
        EndOrigin    origin = EndOrigin::None;   // a close: who
        EndReason    reason = EndReason::None;   // a close (and a release): why
        ConnectionId conn;                       // empty: the host's own (claim)
        const char*  source_sku = "";
        uint8_t      source_slot = 0;
        bool         has_instance = false;       // its id param said who it is
        double       instance = 0;
        bool         has_key = false;            // its key param (re-identification)
        double       key = 0;
        bool         has_value = false;          // the edge's attribute: attack at open, release at release
        double       value = 0;
        double       age_ms = 0;                 // since it opened (at release and close: its duration)
        bool         has_parent = false;         // the id of the instance it belongs to (its parent param)
        double       parent = 0;
        bool         has_confidence = false;     // its confidence param, 0..1
        double       confidence = 0;
    };
    // Called inside poll(), as each edge happens. A host gives a slot's
    // values, then its edges, then its gate's own value (is_gate): the edge,
    // and what it says (origin, reason), before the gate says it ended; and
    // an instance's values before its edges, as on the wire.
    using InstanceCb = void(*)(const InstanceEvent& e, void* ctx);
    // Each value a param of ours whose every sample counts receives, in
    // order (the latest alone is in the param when poll() returns)
    using SampleCb = void(*)(const char* path, const ParamValue& v, void* ctx);
    void on_sample(SampleCb cb, void* ctx) { sample_cb_ = cb; sample_ctx_ = ctx; }
    void on_instance(InstanceCb cb, void* ctx) { instance_cb_ = cb; instance_ctx_ = ctx; }
    // A population's gate (its role, or a bool "on" when none is said)
    bool is_gate(const ParamNode* n) const;
    // What holds a slot now (false: no such population or slot)
    bool instance(const char* population, uint8_t slot, InstanceEvent* out) const;
    // The host's own instance (a mouse on the screen): a slot taken like
    // any other, 0 if none; released when done
    uint8_t claim(const char* population);
    // This node's instances, as a source (9.1, node_instances.cpp): a free
    // slot of one of its populations (its gate down), its id written (ids
    // source: required, and one open with that id is the same instance, its
    // slot returned; ids auto: the population's next), then its gate. Write
    // its values before the next poll: they go ahead of the gate. 0: no such
    // population, no free slot, or no id where one is required.
    uint8_t start_instance(const char* population, const double* id = nullptr);
    // Its gate falls (its reason param, if it has one, said first)
    bool stop_instance(const char* population, uint8_t slot, EndReason reason = EndReason::None);
    bool    release(const char* population, uint8_t slot);
    // The host ends an instance from the mesh: one in release (its resonance
    // is over: done), or one still open (cancel: kept out until its gate
    // falls). Its source is told (ENDED).
    bool    close_instance(const char* population, uint8_t slot);
    // How long a lost source's instances wait before they close, for a
    // population that doesn't say (default 250 ms)
    void set_instance_grace(uint64_t ms) { instance_grace_ms_ = ms; }
    // Source side: a destination ended an instance of one of our populations
    // (its slot here), and why
    struct EndedEvent {
        const char* population = "";             // ours
        uint8_t     slot = 0;
        const char* by_sku = "";                 // the destination's node
        EndReason   reason = EndReason::None;
        bool        has_instance = false;
        double      instance = 0;
    };
    using EndedCb = void(*)(const EndedEvent& e, void* ctx);
    void on_ended(EndedCb cb, void* ctx) { ended_cb_ = cb; ended_ctx_ = ctx; }

    // Remote subscription: if dest_sku is local, applies directly; otherwise forwards to peer.
    expected<void, Error> subscribe_remote(const char* dest_sku, const char* dest_path,
                                                const char* source_sku, const char* source_path,
                                                const Pick& pick = {});
    // Undo a connection by its id, asked of its destination (applied here if ours)
    expected<void, Error> unsubscribe_remote_id(const char* dest_sku, const ConnectionId& id);
    // Undo a connection of ours by its id (origin as for unsubscribe)
    bool unsubscribe_id(const ConnectionId& id, EndOrigin origin = EndOrigin::Destination);
    // The id of the connection dest_path <- source_sku/source_path (empty: none)
    ConnectionId connection_id(const char* dest_path, const char* source_sku, const char* source_path) const;
    // A new connection id, made here (the Lamport clock scenes use)
    ConnectionId next_connection_id();
    // A link of a connection of ours, edited (connection.h LinkEdit): which
    // source param feeds link.dest (LinkSource; empty source: none), its
    // transform (LinkTransform), or back to matching names (LinkReset).
    // The connection is said again to the mesh.
    bool edit_link(const ConnectionId& id, const Link& link, uint8_t what);
    // The same asked of the connection's destination (applied here if ours)
    expected<void, Error> edit_link_remote(const char* dest_sku, const ConnectionId& id,
                                           const Link& link, uint8_t what);
    // What a source said its values are (its stream reply), for one link
    // feeding dest_path; not known until it answers
    SourceShape source_shape(const char* dest_path, const char* source_sku, const char* source_path) const;
    // Who a param of ours streams to, as the source knows it (its stream
    // targets): each destination once, its node and its param (a param of
    // ours too); the visualizers' monitors aside
    using ListenerCb = void(*)(const char* dest_sku, const char* dest_path, void* ctx);
    void listeners(const char* local_path, ListenerCb cb, void* ctx) const;
    // Every stream this node sends, in one pass (9.3): its param (an
    // array's, for one element of it) and whether a visualizer's monitor
    // asked it (a page that watches it) rather than a connection. A param
    // read by several comes once per stream. What an adapter asks its
    // system for (a value pushed, polled) follows this.
    using StreamedCb = void(*)(const ParamNode* param, bool monitor, void* ctx);
    void streamed(StreamedCb cb, void* ctx) const;
    // Our connections, as we keep them
    const ConnectionList& connections() const { return connections_; }
    uint32_t connections_version() const { return conn_version_; }
    expected<void, Error> unsubscribe_remote(const char* dest_sku, const char* dest_path,
                                                  const char* source_sku, const char* source_path);

    // --- Scenes (scene.h, docs/scenes.md) ---
    // Cue the universe: every node applies its own slot (recall) or saves its
    // own incoming connections into it (store). Slots are 1..DATAFLOU_MAX_SCENES.
    bool scene_recall(uint8_t slot);
    bool scene_store(uint8_t slot);
    const SceneCue&    scene_cue() const { return scene_cue_; }
    const SceneStatus& scene_status() const { return scene_status_; }

    // The connections this node keeps in a slot, one call each. False if it
    // has no such slot.
    using SceneLinkCb = void(*)(const char* local_path, const char* source_sku,
                                const char* source_path, void* ctx);
    bool scene_links(uint8_t slot, SceneLinkCb cb, void* ctx);

    // --- Phase: préparation / présentation (scene.h, docs/embarque.md) ---
    // The universe's phase; any node may set it, the latest wins. A node may
    // pin its own (a control desk always in preparation): it still carries
    // the universe's cue, it just doesn't follow it.
    bool  set_phase(Phase p);
    Phase phase() const { return phase_pinned_ ? pinned_phase_ : phase_cue_.phase; }
    const PhaseCue& phase_cue() const { return phase_cue_; }
    void  pin_phase(bool pinned, Phase p = Phase::Preparation);
    bool  phase_pinned() const { return phase_pinned_; }
    using PhaseCb = void(*)(Phase phase, void* ctx);
    void  on_phase(PhaseCb cb, void* ctx) { phase_cb_ = cb; phase_ctx_ = ctx; }

    // A cue was applied here (Recall, Store), or the status changed by itself
    // (Status: connections edited after a recall).
    using SceneCb = void(*)(SceneOp op, uint8_t slot, const SceneStatus& status, void* ctx);
    void on_scene(SceneCb cb, void* ctx);

    // --- Locate and halt (9.1, node_signals.cpp) ---
    // Ask the node that has a param to show where it is (this node's own
    // too): its host lights it at full, nudges it, flashes it, for `ms`
    // (repeat it to hold; 0 stops). The core doesn't touch the value.
    expected<void, Error> locate(const char* sku, const char* path, uint32_t ms = 1500);
    using LocateCb = void(*)(const char* path, bool on, void* ctx);
    void on_locate(LocateCb cb, void* ctx) { locate_cb_ = cb; locate_ctx_ = ctx; }
    bool locating(const char* path) const;
    // The mesh-wide stop: any node sets it, the latest wins, every node
    // follows (a node that joins later too). While on, every destination
    // returns to its init (its ground) and takes no value, and every
    // population's instances close (cancel); off, values flow again.
    void halt(bool on);
    bool halted() const { return halt_cue_.on; }
    const HaltCue& halt_cue() const { return halt_cue_; }
    using HaltCb = void(*)(bool on, void* ctx);
    void on_halt(HaltCb cb, void* ctx) { halt_cb_ = cb; halt_ctx_ = ctx; }

    // --- Accessors ---
    const NodeIdentity& identity() const { return identity_; }
    const ParamStore& local_params() const { return local_params_; }
    uint16_t listen_port() const { return listen_port_; }
    uint32_t stream_sends() const { return dbg_stream_sends_; } // UDP stream packets sent

    // How a node's streams arrive here (9.0): packets received, lost on the
    // way, and come too late (older than one already applied, dropped)
    struct LinkStats { uint32_t received = 0, lost = 0, late = 0; float latency_ms = -1; };
    LinkStats link_stats(const char* sku) const;

    // The mesh's clock: this node's clock plus the offset it agreed on with
    // its peers (ms). Stream packets are stamped with it.
    uint64_t mesh_millis() const {
        return static_cast<uint64_t>(static_cast<int64_t>(clock_.millis()) + clock_offset_ms_);
    }

    // The mesh clock as this node holds it: what it says in HELLO and DIGEST
    ClockState clock_state() const;
    bool clock_synced() const { return clock_synced_; }
    static uint32_t sku_hash(const char* sku) { return crc32_sku(sku); }
    uint32_t clock_rtt() const { return clock_rtt_ms_; }   // to the peer it syncs through

    // A node to dial by address (9.0), for networks where mDNS doesn't
    // reach: tried every few seconds until linked. One is enough: the
    // others' addresses come with the declarations it relays.
    void add_seed(const char* host, uint16_t port);

    // A trigger param fires (same as set_value with a Trigger value)
    void fire(const char* path);
    // Address and mesh port a peer is reached at (connected link first, then
    // the mDNS record of a peer we wait on). False when we have no direct
    // link to it (e.g. a node only known through gossip).
    bool peer_endpoint(const char* sku, const char** addr, uint16_t* port) const {
        for (const auto& p : peers_) {
            if (p.sku == sku && !p.address.empty()) { *addr = p.address.c_str(); *port = p.port; return true; }
        }
        for (const auto& p : pending_peers_) {
            if (p.sku == sku && !p.address.empty()) { *addr = p.address.c_str(); *port = p.port; return true; }
        }
        return false;
    }
    size_t stream_target_count() const { return stream_targets_.size(); }
    // A live connection to that node (its HELLO received)?
    bool connected_to(const char* sku) const {
        for (const auto& p : peers_)
            if (p.sku == sku && p.hello_received && !p.retired && p.socket != INVALID_SOCKET_HANDLE)
                return true;
        return false;
    }
    bool udp_bound() const { return udp_socket_ != INVALID_UDP_HANDLE; }
    void dump_stream_targets(void(*out)(const char*, void*), void* ctx) const {
        for (size_t i = 0; i < stream_targets_.size(); ++i) {
            const auto& t = stream_targets_[i];
            char buf[256];
            snprintf(buf, sizeof(buf), "  ST[%zu] %s -> %s:%u dirty=%d",
                     i, t.local_path.c_str(),
                     t.dest_address.empty() ? "(empty)" : t.dest_address.c_str(),
                     t.dest_udp_port, t.local_node ? t.local_node->dirty : -1);
            out(buf, ctx);
        }
    }

    // Add extra TXT key=value pairs to the mDNS advertisement.
    // Call before start(). Examples: "core_ver=4", "atelier_ver=3".
    void add_txt(const char* kv) {
        if (!extra_txt_.full()) extra_txt_.push_back(kv);
    }

    // Sync local param values into the world view (for visualization)
    void sync_local_to_world();

    // --- Visualizer monitoring ---
    // While on, every remote param's value is streamed into the world view
    // (low rate, sent on change, lowest priority at the source). Hosts turn it
    // on while a visualizer is open; off sends StreamStop for all monitors.
    void set_monitoring(bool on);
    bool monitoring() const { return monitoring_; }
    size_t monitor_count() const { return monitors_.size(); }

private:
    ITcp&     tcp_;
    IMdns&    mdns_;
    IClock&   clock_;
    int64_t   clock_offset_ms_ = 0;        // mesh time - our clock
    // The mesh clock (node_clock.cpp)
    uint32_t  clock_ref_ = 0;              // the reference we follow (a sku hash; ours when we lead)
    bool      clock_synced_ = false;
    uint32_t  clock_rtt_ms_ = 0;           // round trip of the sample in use
    uint64_t  clock_started_ms_ = 0;
    uint64_t  last_clock_ping_ms_ = 0;
    etl::string<36> clock_via_;            // the peer we ping
    struct ClockSample { int64_t offset = 0; uint32_t rtt = 0; };
    static constexpr size_t CLOCK_WINDOW = 8;
    ClockSample clock_window_[CLOCK_WINDOW];
    size_t    clock_samples_ = 0;
    void poll_clock();
    // Seeds (node_peers.cpp)
    struct Seed {
        etl::string<64> host;
        uint16_t port = 0;
        etl::string<36> sku;             // who answered there
        uint64_t last_try_ms = 0;
        bool refused = false;            // another universe or protocol: tried slowly
    };
    Vector<Seed> seeds_;
    void poll_seeds();
    void hint_peer(const char* sku, const char* address, uint16_t port);
    void poll_clock_choice(uint64_t now, uint32_t self);
    IStorage& storage_;
    IUdp&     udp_;

    NodeIdentity identity_;
    etl::string<32> universe_{"default"};
#ifdef DATAFLOU_SOURCE_ONLY
    NodeRole     role_ = NodeRole::Source;
#else
    NodeRole     role_ = NodeRole::Full;
#endif
    uint32_t     host_features_ = 0;   // set_host_features
    ParamStore   local_params_;
    WorldView    world_;
    uint32_t     decl_version_ = 1;
    uint16_t     decl_hold_    = 0;       // hold_declarations() not released yet
    bool         decl_held_    = false;   // a declaration under a hold, said at its release
    uint16_t     listen_port_  = 0;
    bool         running_      = false;
    Vector<etl::string<32>> extra_txt_;
    Vector<etl::string<32>> universes_seen_;
    struct OtherNode { etl::string<36> sku; etl::string<32> universe; uint64_t heard_ms; };
    Vector<OtherNode>       other_universes_;    // the nodes behind universes_seen_
    void universes_changed();

    WorldView::VersionVector relayable_versions() const;
    WorldView::VersionVector relayable_conn_versions() const;

    // Connections (node_connections.cpp): the registry, what each makes
    ConnectionList connections_;
    uint32_t conn_version_ = 0;       // up with each change (HELLO, DIGEST)
    bool     conns_dirty_  = false;   // storage is behind
    bool     scenes_dirty_ = false;   // the scene clock moved (an id was made)
    Connection* find_connection(const ConnectionId& id);
    Connection* find_connection(const char* dest, const char* sku, const char* source);
    // Make every connection's links again from the trees, the params' view
    // of them, and their streams. origin: why a link that went away ended;
    // changed: the list changed already (a connection made or undone)
    void relink(EndOrigin origin = EndOrigin::Connection, bool changed = false);
    bool relinking_ = false;
    // A connection changed: a new version, said to our peers, kept
    void connections_changed();
    // A node's connections in the world view: its params' view of them
    void expand_connections(NodeEntry& entry);
    bool listens_to(const char* sku) const;

    // TCP connections to peers
    struct PeerConnection {
        SocketHandle socket = INVALID_SOCKET_HANDLE;
        etl::string<36> sku;
        etl::string<46> address;
        uint16_t port = 0;
        bool hello_sent     = false;
        bool hello_received = false;
        uint64_t last_msg_ms = 0;
        uint64_t connect_started_ms = 0; // outbound dial in progress (0 = none)
        uint64_t opened_ms = 0;          // connection up (dialled or accepted): its HELLO is due
        uint32_t max_frame = 0;          // from its HELLO (0: not said, no limit known)
        NodeRole role = NodeRole::Full;  // from its HELLO
        uint32_t skip_bytes = 0;         // rest of a frame too big for recv_buf, discarded
        // What the socket didn't take yet, in order, whole frames (from
        // send_at); sent at the next polls
        Vector<uint8_t> send_buf;
        size_t send_at = 0;
        bool broken = false;             // its backlog overflowed: closed at the next poll
        bool retired = false;            // replaced by a newer connection to the same node: closed, to remove
        uint64_t hello_ms = 0;           // when its HELLO came (the grace before it can be closed)
        bool detached = false;           // it said DETACH: its close doesn't mean it went offline
        uint32_t features = 0;           // from its HELLO (Feature bits)
        ClockState clock;                // its mesh clock (HELLO, DIGEST, TIME)
        uint32_t clock_rtt = UINT32_MAX; // last TIME round trip to it (ms)
        int8_t seed = -1;                // dialled as seed n (seeds_)

        // Receive buffer for length-prefixed framing: grows with the frames
        // that arrive, up to DATAFLOU_RECV_BUF_SIZE
        Vector<uint8_t> recv_buf;
    };
    StableVector<PeerConnection> peers_;
    void handle_time(PeerConnection& peer, const MsgTime& t);
    bool clock_ref_alive(uint32_t ref, const PeerConnection& via) const;
    SocketHandle listener_ = INVALID_SOCKET_HANDLE;

    // mDNS-discovered peers waiting for inbound connection (we have higher SKU).
    // Cached so we can populate address/port when their HELLO arrives.
    struct PendingPeer {
        etl::string<36> sku;
        etl::string<46> address;
        uint16_t port = 0;
    };
    Vector<PendingPeer> pending_peers_;

    // Shared encode buffer (single-threaded poll, no concurrency): 1 KB, grown
    // by encode() as a message needs, up to DATAFLOU_MAX_MSG_BUF
    Vector<uint8_t> encode_buf_;
    static constexpr size_t ENCODE_BUF_START = 1024;

    // Encodes with f(span) into encode_buf_, growing it while the message
    // doesn't fit. Returns the length, 0 if it can't be encoded.
    template <typename F>
    size_t encode(F&& f) {
        for (;;) {
            const size_t len = f(etl::span<uint8_t>(encode_buf_.data(), encode_buf_.size()));
            if (len > 0) return len;
            const size_t have = encode_buf_.size();
            if (have >= DATAFLOU_MAX_MSG_BUF) return 0;
            const size_t next = have * 2 < DATAFLOU_MAX_MSG_BUF ? have * 2 : DATAFLOU_MAX_MSG_BUF;
            if (!encode_buf_.resize(next ? next : ENCODE_BUF_START)) {
                log("A message needs %u bytes to encode: out of memory", static_cast<unsigned>(next));
                return 0;
            }
        }
    }

    // Sequence counter
    uint32_t seq_ = 0;

    // Timing
    uint64_t last_digest_ms_  = 0;
    uint64_t last_persist_ms_ = 0;
    uint64_t last_keepalive_ms_ = 0;
    bool     world_marker_written_ = false;

    static constexpr uint64_t STREAM_KEEPALIVE_INTERVAL_MS = 15000;
    static constexpr uint64_t STREAM_KEEPALIVE_TIMEOUT_MS  = 30000;

    // Callbacks
    PeerCb     peer_joined_cb_  = nullptr;
    void*      peer_joined_ctx_ = nullptr;
    PeerCb     peer_left_cb_    = nullptr;
    void*      peer_left_ctx_   = nullptr;
    TopologyCb topo_cb_         = nullptr;
    void*      topo_ctx_        = nullptr;
    LogCb        log_cb_            = nullptr;
    void*        log_ctx_           = nullptr;
    ParamAdminCb param_admin_cb_    = nullptr;
    void*        param_admin_ctx_   = nullptr;
    BlobCb       blob_cb_           = nullptr;
    void*        blob_ctx_          = nullptr;
    BlobProviderCb blob_provider_cb_ = nullptr;
    void*          blob_provider_ctx_ = nullptr;
    IdentifyCb     identify_cb_  = nullptr;
    void*          identify_ctx_ = nullptr;
    SceneCb        scene_cb_     = nullptr;
    void*          scene_ctx_    = nullptr;

    // Scenes
    SceneCue    scene_cue_;                         // the universe's current recall cue
    SceneStamp  scene_applied_;                     // last recall cue applied here
    SceneStamp  scene_stored_[DATAFLOU_MAX_SCENES]; // last store cue seen per slot
    SceneStatus scene_status_;
    uint32_t    scene_clock_    = 0;                // highest counter seen (Lamport)
    bool        applying_scene_ = false;

    SceneStamp next_scene_stamp();

    PhaseCue phase_cue_;
    // Locate and halt (node_signals.cpp)
    struct Locating { Text path; uint64_t until = 0; };
    Vector<Locating> locating_;
    LocateCb locate_cb_ = nullptr;
    void*    locate_ctx_ = nullptr;
    HaltCue  halt_cue_;
    HaltCb   halt_cb_ = nullptr;
    void*    halt_ctx_ = nullptr;
    void handle_locate(const MsgLocate& m);
    void poll_locates();
    void handle_halt(const HaltCue& cue, const PeerConnection* from);
    void apply_halt();
    void load_halt();
    void persist_halt();
    bool     phase_pinned_ = false;
    Phase    pinned_phase_ = Phase::Preparation;
    PhaseCb  phase_cb_  = nullptr;
    void*    phase_ctx_ = nullptr;
    void handle_phase(const PhaseCue& cue, const PeerConnection* from);
    void phase_changed(Phase before);
    void load_phase();
    void persist_phase();
    void handle_scene(SceneOp op, uint8_t slot, const SceneStamp& stamp,
                      const PeerConnection* from);
    void merge_scene_cue(const SceneCue& cue);     // from HELLO / DIGEST
    void apply_scene();                            // our slot of scene_cue_
    void store_scene(uint8_t slot);
    void scene_touched();                          // connections edited by hand
    void set_scene_status(const SceneStatus& st, SceneOp op, uint8_t slot);
    void send_scene(const MsgScene& msg, const PeerConnection* except);
    void load_scenes();
    void persist_scenes();

    // Internal
    void poll_mdns();
    void poll_tcp_accept();
    void poll_tcp_peers();
    void poll_timeouts();
    void poll_digest();
    void poll_persist();

    void handle_peer_found(const MdnsEvent& ev);
    void handle_peer_lost(const MdnsEvent& ev);
    void handle_message(PeerConnection& peer, etl::span<const uint8_t> data);

    void send_hello(PeerConnection& peer);
    void mirror_own_tree(NodeEntry& self);
    // Bump decl_version, mirror the local declaration into world_, and
    // re-declare to connected peers. Every local schema change goes through here.
    void redeclare();
    void refused_declaration(const char* path, const ParamMetaCore* meta = nullptr);   // logs why (kMaxPathLength, an array's shape, memory)
    void persist_decl_version();
    bool connection_lost(PeerConnection& peer);
    // Close a connection on purpose, telling the peer we are still here
    void detach(PeerConnection& peer, const char* why);
    void send_declare_self(PeerConnection& peer);
    void send_declare_about(PeerConnection& peer, const NodeEntry& entry);
    bool fits(const PeerConnection& peer, size_t len, const char* what);
    void send_digest(PeerConnection& peer);
    void send_connections(PeerConnection& peer, const NodeEntry& about);
    // The lists a peer is behind on, from its versions (HELLO, DIGEST "cv")
    void send_missing_connections(PeerConnection& peer, const WorldView::VersionVector& theirs);
    void send_flush(const char* target_sku);

    PeerConnection* find_peer_by_sku(const char* sku);
    void disconnect_peer(PeerConnection& peer);

    void log(const char* fmt, ...);
    void persist_world(bool force = false);   // force: write even if unchanged
    void load_persisted_world();

    // --- UDP streaming ---
    UdpHandle udp_socket_ = INVALID_UDP_HANDLE;
public:
    uint32_t dbg_stream_sends_ = 0;
    uint32_t dbg_stream_skips_ = 0;
    uint32_t dbg_encode_fails_ = 0;
private:

    struct StreamTarget {
        etl::string<36>  dest_sku;
        etl::string<46>  dest_address;
        uint16_t         dest_udp_port = 0;
        Text             local_path;
        Text             dest_path;      // path within dest node's param store
        ParamNode*       local_node = nullptr;
        float            rate_hz    = 0.0f;
        uint64_t         last_sent_ms = 0;
        uint64_t         last_request_ms = 0; // keepalive: last StreamRequest received
        bool             monitor = false;     // visualizer monitor (empty dest_path)
        uint32_t         last_epoch = 0;      // change_epoch last sent
        uint32_t         replied_decl = 0;    // decl_version_ our stream reply told
        uint16_t         id = 0;              // our number for this stream (packets carry it)
        uint16_t         seq = 0;             // packets sent (wraps)
        uint8_t          named_left = 3;      // first packets that carry the path too
        ConnectionId     conn;                // the connection it serves (9.1)
        // One element of an array (9.3): local_path names it ("harmonics/3"),
        // local_node is the array; -1: the param whole
        int32_t          element = -1;
    };
    // One tick's entries, before they go out a packet per destination (9.1);
    // keeps its room between ticks
    struct Outgoing {
        StreamTarget* target = nullptr;
        bool          refresh = false;
        bool          gate = false;           // a population's gate: after its values
        bool          has_value = false;      // a value of its own (a gate's edge, a sample), not the current
        ParamValue    value;
        uint64_t      stamp = 0;              // that value's mesh time (9.3)
        int           pass = 0;               // its turn in the packet (pass_of)
    };
    Vector<Outgoing> outgoing_;
    // A gate of ours that moved, a param whose every sample counts: each
    // write goes out, so a tap shorter than a send interval still opens and
    // closes, and a stream arrives whole
    struct Written { const ParamNode* node = nullptr; ParamValue value; uint32_t epoch = 0; uint64_t at = 0;
                     uint64_t stamp = 0; };   // its mesh time, when stamped (9.3)
    Vector<Written> written_;
    void send_outgoing(uint64_t now);
    struct Listened {
        Text path, source, source_path;
        Pick pick;
    };
    Vector<Listened> listening_;   // what listen() waits for
    void make_listened();
    // A frame to a peer: its 4-byte length, then the payload, whole and in
    // order; what the socket doesn't take now waits for the next polls
    void send_framed(SocketHandle s, etl::span<const uint8_t> payload);
    void flush_sends(PeerConnection& peer);
    Vector<uint8_t> udp_out_, udp_in_;   // a stream packet out, one in (DATAFLOU_UDP_BUF_SIZE)
    Vector<uint8_t> udp_names_;          // the paths a packet out names (send_outgoing), as long
    bool udp_buffer(Vector<uint8_t>& buf);
    void receive_entry(uint32_t sku_hash, const struct DecodedStreamEntry& e, int32_t took, uint64_t now,
                       uint32_t sent, bool synced);
    uint16_t next_stream_id_ = 1;
    uint16_t next_stream_id();
    bool send_fire(const StreamTarget& t);

    // Receiver side: the path a source's stream id stands for (from the
    // stream's named packets and its reply), and how the stream arrives
    // Every stream into this node has a number this node gave it (9.1),
    // its connections' and the visualizer's monitors' alike: the number
    // says which stream, whoever sends it; the source's hash only checks it
    struct StreamName {
        etl::string<36> sku;                  // its source
        uint32_t sku_hash = 0;
        uint16_t id = 0;
        uint16_t last_seq = 0;
        bool     seen = false;
        Text     path;
        Text     dest_path;               // from the reply: the one destination it feeds
        uint32_t received = 0, lost = 0, late = 0;
        float    latency_ms = -1;         // mesh time on arrival - on departure (smoothed)
    };
    Vector<StreamName> stream_names_;
    StreamName* stream_name(uint16_t id);
    StreamName* name_stream(const char* sku, uint16_t id, const Text& path, const Text& dest_path);
    void forget_stream_name(uint16_t id);
    void restart_stream_names(const char* sku);
    uint32_t dbg_unnamed_ = 0;                // packets under a number we didn't give
    uint32_t dbg_foreign_ = 0;                // packets under one of ours, from another source
    void deliver_value(const etl::string<36>& sku, const Text& path, const Text& dest_path,
                       const ParamValue& value, bool refresh, uint64_t now);
    // Values that carry their time (9.3): one that arrives goes on at once
    // (past, unstamped, too far ahead) or is held until its time. What a
    // value delivered now is stamped with (0: none): set_received keeps it.
    void arrive(const etl::string<36>& sku, const Text& path, const Text& dest_path,
                const ParamValue& value, bool refresh, uint64_t at, uint64_t now);
    struct Held {
        etl::string<36> sku;
        Text            path, dest_path;
        ParamValue      value;
        bool            refresh = false;
        uint64_t        at = 0;               // mesh time
    };
    Vector<Held> held_;
    uint64_t hold_horizon_ms_ = 10000;
    uint64_t delivering_at_ = 0;
    uint64_t far_logged_ms_ = 0;              // the last "too far ahead" said
    void poll_held();
    bool timed_to(const char* sku);           // a peer that reads stamped values
    Vector<StreamTarget> stream_targets_;
    // A connection sends by its source's mode: discrete on change (capped by
    // rate), streaming at rate continuously. An unchanged value goes out as a
    // refresh, which a receiver applies only if it differs.
    static constexpr uint64_t DISCRETE_REFRESH_MS = 1000; // against UDP loss
    static constexpr float    STREAMING_DEFAULT_HZ = 60.0f; // streaming, rate 0

    struct InboundEntry {
        uint32_t         source_sku_hash = 0;
        etl::string<36>  source_sku;
        Text             source_path;
        Text             local_path;
        ParamNode*       local_node = nullptr;
        const WorldParamNode* source_node = nullptr; // cached from world view
        uint32_t         source_gen = 0;              // world_gen_ when it was cached
        ConnectionId     id;                          // the connection's
        WorldParamNode*  local_world_node = nullptr;  // cached for WV updates
        uint16_t         sid = 0;                     // the stream id we asked it to carry
        uint16_t         conn = ParamSubscription::NONE, link = ParamSubscription::NONE;
        SourceShape      shape;                       // from the source's stream reply
        // A link into populations (9.1), nested or not: local_path is only
        // its key; which slots it feeds is the allocation's, level by level.
        // levels: how many populations it crosses (0: an ordinary link);
        // chain: the source's slot at each level, outermost first
        static constexpr uint8_t DEPTH = 4;
        uint8_t          levels = 0;
        uint8_t          chain[DEPTH] = {};
        Text             source_pop;                      // the source's innermost population, concrete
        ParamRole        role = ParamRole::None;          // of its destination param
        uint32_t chain_key() const {
            uint32_t k = 0;
            for (uint8_t i = 0; i < levels; ++i) k |= static_cast<uint32_t>(chain[i]) << (8 * i);
            return k;
        }
        uint8_t source_slot() const { return levels ? chain[levels - 1] : 0; }
        // A picked connection's (9.1): the source's slot it reads, its link
        // (NONE: a gate or an id watched for the pick, feeding nothing)
        uint8_t          pick_slot = 0;
        // Into a destination that merges (9.3, merge_of not LTP): this
        // link's last value, already in the destination's range and type,
        // while it contributes (until its link goes or its source is lost).
        // Kept across a relink. An array's (last.tag Array): its elements,
        // packed as in a value, in last_elems (its block reused packet to
        // packet: the same size each time).
        bool             contributes = false;
        ParamValueCore   last;
        Text             last_elems;
        // Its source lost: it still contributes until then (the grace a
        // destination gives a lost source, dest_grace_ms_), back with a
        // value before; 0: not leaving
        uint64_t         leaves_at = 0;
    };
    uint16_t next_inbound_sid_ = 1;
    uint16_t new_inbound_sid(const Vector<InboundEntry>* also = nullptr);

    // Populations of ours (9.1): what holds each slot
    struct Holder {
        uint8_t      life = 0;           // its state in the instance machine (node_populations.cpp)
        uint32_t     chain = 0;          // the source's slots down to this instance (InboundEntry::chain_key)
        Text         source_pop;         // the source's population, where its instance lives (ENDED)
        bool         used = false;       // held by an instance (open, or released and held)
        bool         open = false;       // taken
        bool         host = false;       // claimed by our host
        bool         committed = false;
        bool         released = false;
        ConnectionId conn;
        etl::string<36> sku;
        uint8_t      source_slot = 0;
        bool         has_instance = false;
        double       instance = 0;
        bool         has_key = false;
        double       key = 0;
        bool         has_attack = false, has_release = false;
        double       attack = 0, release_value = 0;
        bool         has_parent = false, has_confidence = false;
        double       parent = 0, confidence = 0;
        EndReason    said = EndReason::None; // what its reason param says
        uint64_t     opened_ms = 0;
        uint32_t     order = 0;          // the how-manyth opened here: the oldest gives way
        uint64_t     released_ms = 0;
        uint64_t     hold_until = 0;     // released and held: closes then (0: by the host)
        uint64_t     lost_at = 0;        // its source went: closes past the grace
        EndOrigin    end = EndOrigin::None;
        EndReason    reason = EndReason::None;
    };
    struct Population {
        Text path;
        Vector<Holder> slots;            // slot k at k - 1
        uint32_t next_id = 1;            // ids: auto, this node's instances as a source
    };
    Vector<Population> populations_;
    // A source's slots whose id was written for their current instance (an
    // id param each); a gate rising without one gets one (ids auto) or is
    // refused (ids source). node_instances.cpp
    Vector<const ParamNode*> fresh_ids_;
    bool give_id(const char* gate_path, const ParamNode* gate);
    void id_written(const ParamNode* n);
    void slot_ended(const ParamNode* gate);
    uint32_t open_order_ = 0;
    // Values of an instance not open yet (they come before its gate)
    struct Pending {
        ConnectionId conn;
        uint32_t     chain = 0;
        uint16_t     link = 0;
        ParamValue   value;
        uint64_t     at = 0;
    };
    Vector<Pending> pending_values_;
    // Instances that gave way, were refused or closed here: kept out until
    // their gate falls or a new id comes (their refreshes would take a slot again)
    struct Evicted {
        ConnectionId conn;
        uint32_t     chain = 0;
        bool         has_instance = false;
        double       instance = 0;
    };
    Vector<Evicted> evicted_;
    Evicted* evicted(const ConnectionId& conn, uint32_t chain);
    void evict(const ConnectionId& conn, uint32_t chain, bool has_instance, double instance);
    InstanceCb instance_cb_ = nullptr;
    void*      instance_ctx_ = nullptr;
    SampleCb   sample_cb_ = nullptr;
    void*      sample_ctx_ = nullptr;
    EndedCb    ended_cb_ = nullptr;
    void*      ended_ctx_ = nullptr;
    uint64_t   instance_grace_ms_ = 250;
    Population* population(const char* path);
    uint16_t population_index(const char* path);       // made if new
    void deliver_poly(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now);
    // Connections that pick one instance of a source population (9.1): the
    // source's slots as they live, the last value of each link from each,
    // and the slot that feeds the destination now
    struct PickedSlot {
        bool     live = false;
        bool     has_id = false;
        double   id = 0;
        uint32_t order = 0;              // when it went live: higher is newer
    };
    struct Picked {
        ConnectionId       conn;
        bool               gated = false;   // the template has a gate: else a slot lives from its first value
        uint8_t            current = 0;     // the source's slot that feeds; 0 none
        uint32_t           order = 0;
        uint16_t           links = 0;
        Vector<PickedSlot> slots;           // [slot - 1]
        Vector<ParamValue> last;            // [(slot - 1) * links + link]
        Vector<uint8_t>    have;            // the same: a value came
        Pick               pick;            // as the connection said when last relinked
    };
    Vector<Picked> picked_;
    Picked* picked(const ConnectionId& conn);
    void deliver_picked(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now);
    uint8_t picked_slot(const Picked& pk) const;
    void feed_picked(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now);
    void repick(Picked& pk, uint64_t now);
    void picks_lost(const char* sku);
    // Into one destination param: mapped from the source, cast, received
    void deliver_into(InboundEntry& ie, ParamNode* dest, const char* dest_path,
                      const ParamValue& value, bool refresh, uint64_t now);
    uint8_t allocate(Population& p, uint8_t want, uint64_t now);
    // An instance's life, a transition table run by etl::state_chart: one
    // event for the instance in slot `slot` of `p`
    struct Life;
    void live(Population& p, uint8_t slot, uint8_t event, const InboundEntry* ie, uint64_t now,
              EndOrigin origin = EndOrigin::Connection);
    void open_slot(Population& p, uint8_t slot, const InboundEntry& ie, uint64_t now);
    void release_edge(Population& p, uint8_t slot, EndReason reason, uint64_t now);
    void close_inner(const Population& p, uint8_t slot, EndOrigin origin, EndReason reason);
    void take_role(Holder& h, ParamRole role, const ParamValue& v);
    void orphan_children(const Holder& parent);   // the instances that named it lose their parent
    void close_slot(Population& p, uint8_t slot, EndOrigin origin, EndReason reason, bool ground);
    void set_gate(Population& p, uint8_t slot, bool on);
    static bool is_gate_param(const ParamNode* n);   // its role, or a bool "on" when none is said
    void emit_instance(const Population& p, uint8_t slot, Edge edge);
    void send_ended(const Holder& h, EndReason reason);
    void handle_ended(const char* from, const struct MsgEnded& m);
    void poll_populations();
    void populations_lost(const char* sku, bool lost);  // a source went, or came back
    void cut_instances(EndOrigin origin, uint64_t now);
    Vector<InboundEntry> inbound_stream_;
    // Goes up whenever the world view's trees may have moved: a node's
    // params replaced, a node added or removed. A pointer into the world
    // view cached before is not to be followed after.
    uint32_t world_gen_ = 1;

    void poll_stream();
    void poll_stream_keepalive();

    // Destination side. ground: a destination no longer fed (its last
    // connection removed, or its source gone past the grace) returns to its
    // init in its ground durations, straight in its nature (a glide).
    struct Glide {
        Text     path;
        uint8_t  count = 0;      // components
        double   pos[4] = {};
        double   target[4] = {};
        double   speed[4] = {};  // per ms; 0: jump
        bool     log_space = false; // positions are ln(value) (a log param)
        uint64_t last_ms = 0;
    };
    Vector<Glide> glides_;
    Vector<Text> dest_pending_;   // destinations waiting or grounding
    // Connections undone this poll, settled at the next: a scene that swaps
    // a source (removed, then the new one made) doesn't ground in between
    struct PendingEnd { Text path; EndOrigin origin = EndOrigin::None; };
    Vector<PendingEnd> ends_pending_;
    DestCb   dest_cb_  = nullptr;
    void*    dest_ctx_ = nullptr;
    uint64_t dest_grace_ms_ = 1000;
    size_t live_sources(const ParamNode* node) const;
    // Re-read a destination's state from its connections; origin: why it
    // may have lost one (None when nothing ended)
    void settle_destination(ParamNode* node, const char* path, EndOrigin origin);
    void set_destination(ParamNode* node, const char* path, DestState s, EndOrigin o);
    void start_ground(ParamNode* node, const char* path, EndOrigin origin);
    void settle_fed_by(const char* sku, EndOrigin origin);   // every destination that sku feeds
    // Merging at the destination (9.3): what the links that contribute to
    // `dest` combine to by its mode (false: none contributes; `count`: how
    // many do), and that result applied when it changed
    bool merged_value(const ParamNode* dest, ParamValue& out, size_t* count = nullptr) const;
    bool merged_array(const ParamNode* dest, bool htp, ParamValue& out, size_t* count) const;
    void remerge(ParamNode* dest, const char* path, uint64_t now);
    static constexpr uint64_t GLIDE_STEP_MS = 10;
    void receive_value(ParamNode* node, const char* path, const ParamValue& v, uint64_t now,
                       bool refresh = false);
    void set_received(ParamNode* node, const char* path, const ParamValue& v);
    void mirror_source(const InboundEntry& ie, const ParamValue& value);
    void poll_glides();
    void poll_destinations();
    // Links of a merge whose source was lost, leaving past the grace (9.3)
    void poll_merge_leaves();
    bool merge_leaves_ = false;

    uint64_t connection_grace_ms_ = 15000;
    uint64_t last_presentation_ms_ = 0;
    uint64_t last_limit_ms_ = 0;
    bool     limit_logged_ = false;
    // A transport with few connections: keep one spare, closing the least
    // useful (we don't listen to it, it doesn't listen to us) past its grace.
    void poll_connection_limit();
    // Presentation: only connections that carry values stay (and a
    // satellite's one link to a full node, for the cues)
    void poll_presentation_links();
    bool wanted_in_presentation(const char* sku, NodeRole unknown = NodeRole::Full) const;
    bool listened_by(const char* sku) const;   // that node takes values from us
    const PeerConnection* anchor() const;
    // Closed to keep a spare: when one comes back still at the limit, it is
    // closed at once rather than given another grace
    struct ClosedPeer { etl::string<36> sku; uint64_t at_ms = 0; };
    Vector<ClosedPeer> closed_for_room_;
    int  usefulness(const PeerConnection& peer) const;
    size_t open_peers() const;

    Vector<IncompatibleNode> incompatible_;
    void note_incompatible(const char* sku, const char* label, uint8_t core_major, uint8_t proto,
                           const char* address, uint16_t port, const char* core_ver,
                           const char* product);

    uint64_t forget_after_ms_ = 60000;
    uint64_t last_forget_ms_  = 0;
    void poll_forget();
    // Forget the offline node heard from longest ago (those we don't listen
    // to first), never `keep`. False if there is none.
    bool forget_oldest_offline(const char* keep);
    void forget(const char* sku, const char* why);
    void mark_offline(const char* sku); // world view + ground what it fed

    // Visualizer monitors (requester side)
    struct MonitorEntry {
        etl::string<36>  sku;
        uint32_t         sku_hash = 0;
        Text             path;
        uint16_t         sid = 0;             // the number we gave its stream
        // Asked, and no value since: asked again at each DECLARE of its
        // node (a host back after a restart declares its params after its
        // HELLO, and drops a request for one it doesn't have yet)
        bool             waiting = false;
    };
    Vector<MonitorEntry> monitors_;
    Vector<MonitorEntry> monitors_wanted_;    // scratch for poll_monitors, keeps its room
    bool     monitoring_       = false;
    bool     monitors_stale_   = false; // topology changed: recompute the set
    uint64_t last_monitor_ms_  = 0;
    static constexpr float    MONITOR_RATE_HZ        = 10.0f;
    static constexpr uint64_t MONITOR_REFRESH_MS     = 1000; // resend unchanged values
    void poll_monitors();
    void stop_monitors();
    void topology_changed(); // fire topo_cb_ and mark monitors stale
    void rebuild_inbound_stream();
    void rebuild_picked_streams();
    void walk_inbound_recurse(const ParamNode* node, const char* path_prefix);

    void send_stream_request(const char* source_sku, const char* source_path,
                             const char* local_path, float rate_hz, bool quiet = false,
                             uint16_t stream_id = 0, const ConnectionId& conn = {});
    void send_stream_request(const InboundEntry& ie, bool quiet = false);
    void send_stream_stop(const char* source_sku, const char* source_path,
                          const char* local_path, bool quiet = false);
    void resend_stream_requests_for_peer(const char* peer_sku);   // its connections' and monitors' (HELLO)
    void ask_waiting_monitors(const char* peer_sku);              // the monitors of it no value answered (DECLARE)

    static uint32_t crc32_sku(const char* sku);
};

} // namespace dataflou
