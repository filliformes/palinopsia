// node_storage.cpp — what a node keeps across a restart: its connections,
// its scenes and the phase.

#include "node_internal.h"

namespace dataflou {

// --- Internal: periodic persist ---

void Node::poll_persist() {
    uint64_t now = clock_.millis();
    if ((now - last_persist_ms_) < PERSIST_INTERVAL_MS) return;
    last_persist_ms_ = now;
    persist_world();
}

// --- Internal: persistence ---

// Connections are kept as a CBOR record (connection.h): "connections" for
// ours, "scene_<n>" for a scene slot.
//
// Before 9.1 (read, never written) a record was a list of param-to-param
// subscriptions (integers LE):
// [2] 0xFFFF, [1] format (2), [2] entry_count
// Per entry:
//   [1] local_path_len, [N] local_path
//   [1] source_sku_len, [N] source_sku
//   [1] source_path_len, [N] source_path
//   [4] connection counter, [4] connection origin
// Before 9.0: [2] entry_count, entries without the id.

static constexpr size_t SUBS_HEAD = 5;

static void put_u32(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
    p[2] = static_cast<uint8_t>(v >> 16);
    p[3] = static_cast<uint8_t>(v >> 24);
}

static uint32_t get_u32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

// A whole record from storage, whatever its size: the read is retried with
// twice the room while it fills the buffer. False if missing (or out of memory).
static bool read_record(IStorage& storage, const char* key, Vector<uint8_t>& out) {
    size_t room = 1024;
    for (;;) {
        if (!out.resize(room)) { out.clear(); return false; }
        size_t len = 0;
        if (!storage.read(key, etl::span<uint8_t>(out.data(), out.size()), len)) {
            out.clear();
            return false;
        }
        if (len < room) { out.resize(len); return true; }
        room *= 2;
    }
}

// The entry count, where the entries start and whether they carry ids
static uint16_t subscription_count(const uint8_t* buf, size_t len, size_t* start = nullptr,
                                   bool* ids = nullptr) {
    if (len >= SUBS_HEAD && buf[0] == 0xFF && buf[1] == 0xFF && buf[2] == 2) {
        if (start) *start = SUBS_HEAD;
        if (ids) *ids = true;
        return static_cast<uint16_t>(buf[3]) | (static_cast<uint16_t>(buf[4]) << 8);
    }
    if (start) *start = 2;
    if (ids) *ids = false;
    if (len < 2) return 0;
    return static_cast<uint16_t>(buf[0]) | (static_cast<uint16_t>(buf[1]) << 8);
}

// f(local_path, source_sku, source_path, id) for each serialized subscription
// (id empty in a record from before 9.0).
template <typename F>
static void for_each_subscription(const uint8_t* buf, size_t len, F&& f) {
    size_t pos = 0;
    bool ids = false;
    const uint16_t count = subscription_count(buf, len, &pos, &ids);
    etl::string<255> local_path;      // a record says each length in a byte
    etl::string<36>  source_sku;
    etl::string<255> source_path;
    ConnectionId id;
    for (uint16_t i = 0; i < count && pos < len; ++i) {
        uint8_t n = buf[pos++];
        if (pos + n > len) return;
        local_path.assign(reinterpret_cast<const char*>(buf + pos), n);
        pos += n;

        if (pos >= len) return;
        n = buf[pos++];
        if (pos + n > len) return;
        source_sku.assign(reinterpret_cast<const char*>(buf + pos), n);
        pos += n;

        if (pos >= len) return;
        n = buf[pos++];
        if (pos + n > len) return;
        source_path.assign(reinterpret_cast<const char*>(buf + pos), n);
        pos += n;

        if (ids) {
            if (pos + 8 > len) return;
            id.counter = get_u32(buf + pos);
            id.origin  = get_u32(buf + pos + 4);
            pos += 8;
        }
        f(local_path, source_sku, source_path, id);
    }
}

// A record of connections, either format. Connections saved before 9.0
// have no id: they get one from `mint`.
template <typename Mint>
static bool read_connections(IStorage& storage, const char* key, uint32_t& version,
                             ConnectionList& out, Mint&& mint) {
    Vector<uint8_t> buf;
    if (!read_record(storage, key, buf) || buf.size() < 2) return false;
    out.clear();
    if (decode_connection_record(etl::span<const uint8_t>(buf.data(), buf.size()), version, out))
        return true;
    out.clear();
    version = 0;
    for_each_subscription(buf.data(), buf.size(), [&](const etl::istring& lp, const etl::istring& ss,
                                                      const etl::istring& sp, const ConnectionId& id) {
        Connection* c = out.emplace_back();
        if (!c) return;
        c->id = id.empty() ? mint() : id;
        c->dest = lp.c_str();
        c->source_sku = ss.c_str();
        c->source = sp.c_str();
    });
    return true;
}

// Into `out`, the record of a list. False out of memory (or too big).
static bool write_connections(IStorage& storage, const char* key, uint32_t version,
                              const ConnectionList& list) {
    Vector<uint8_t> buf;
    for (size_t room = 256; room <= (1u << 20); room *= 2) {
        if (!buf.resize(room)) return false;
        const size_t len = encode_connection_record(etl::span<uint8_t>(buf.data(), buf.size()),
                                                    version, list);
        if (len > 0) return storage.write(key, etl::span<const uint8_t>(buf.data(), len));
    }
    return false;
}

void Node::persist_world(bool force) {
    // World marker: once per start (or universe)
    if (!world_marker_written_) {
        const char* marker = "dataflou_world_v1";
        world_marker_written_ = storage_.write("world", etl::span<const uint8_t>(
            reinterpret_cast<const uint8_t*>(marker), strlen(marker)));
    }

    // Our connections, when they changed
    if (conns_dirty_ || force) {
        if (write_connections(storage_, "connections", conn_version_, connections_))
            conns_dirty_ = false;
        else
            log("Storage: out of memory, %u connections will not survive a restart",
                static_cast<unsigned>(connections_.size()));
    }
    // The scene clock, when a connection id moved it
    if (scenes_dirty_) {
        persist_scenes();
        scenes_dirty_ = false;
    }
}

void Node::load_persisted_world() {
    uint8_t buf[64];
    size_t len = 0;
    if (storage_.read("world", etl::span<uint8_t>(buf), len)) {
        log("Loaded persisted world data (%zu bytes)", len);
    }

    // Our connections: the record, or the subscriptions saved before 9.1
    // (then written in the new format at the next persist)
    uint32_t version = 0;
    if (read_connections(storage_, "connections", version, connections_,
                         [this] { return next_connection_id(); })) {
        conn_version_ = version;
    } else if (read_connections(storage_, "subscriptions", version, connections_,
                                [this] { return next_connection_id(); })) {
        conn_version_ = 1;
        conns_dirty_ = true;
    }
    if (!connections_.empty())
        log("Restored %u connections from storage", static_cast<unsigned>(connections_.size()));
}

// --- Scenes ---
//
// Storage: "scene_<n>" holds slot n in the subscription format above (count 0:
// an empty slot, which recall applies by removing every connection; no record:
// a missing slot). "scenes" holds the cue state:
// [1] format (1)
// [1] cue slot, [4] cue counter, [4] cue origin
// [4] applied counter, [4] applied origin
// [1] state, [1] skipped, [4] Lamport clock          (integers LE)

static void scene_key(uint8_t slot, char* out, size_t n) {
    snprintf(out, n, "scene_%u", static_cast<unsigned>(slot));
}


static bool valid_store_slot(uint8_t slot) {
    return slot >= 1 && slot <= DATAFLOU_MAX_SCENES;
}

void Node::load_scenes() {
    scene_cue_     = SceneCue{};
    scene_applied_ = SceneStamp{};
    scene_status_  = SceneStatus{};
    scene_clock_   = 0;
    for (auto& s : scene_stored_) s = SceneStamp{};

    uint8_t buf[32];
    size_t len = 0;
    if (storage_.read("scenes", etl::span<uint8_t>(buf), len) && len >= 24 && buf[0] == 1) {
        scene_cue_.slot          = buf[1];
        scene_cue_.stamp.counter = get_u32(buf + 2);
        scene_cue_.stamp.origin  = get_u32(buf + 6);
        scene_applied_.counter   = get_u32(buf + 10);
        scene_applied_.origin    = get_u32(buf + 14);
        scene_status_.current    = scene_cue_.slot;
        scene_status_.state      = buf[18] <= static_cast<uint8_t>(SceneState::Missing)
                                       ? static_cast<SceneState>(buf[18]) : SceneState::None;
        scene_status_.skipped    = buf[19];
        scene_clock_             = get_u32(buf + 20);
    }

    char key[16];
    uint8_t head[2];
    for (uint8_t n = 1; n <= DATAFLOU_MAX_SCENES; ++n) {
        scene_key(n, key, sizeof(key));
        size_t slot_len = 0;
        if (storage_.read(key, etl::span<uint8_t>(head), slot_len) && slot_len >= 2) {
            scene_status_.slots |= 1u << (n - 1);
        }
    }
}

void Node::persist_scenes() {
    uint8_t buf[24];
    buf[0] = 1;
    buf[1] = scene_cue_.slot;
    put_u32(buf + 2,  scene_cue_.stamp.counter);
    put_u32(buf + 6,  scene_cue_.stamp.origin);
    put_u32(buf + 10, scene_applied_.counter);
    put_u32(buf + 14, scene_applied_.origin);
    buf[18] = static_cast<uint8_t>(scene_status_.state);
    buf[19] = scene_status_.skipped;
    put_u32(buf + 20, scene_clock_);
    storage_.write("scenes", etl::span<const uint8_t>(buf, sizeof(buf)));
}

SceneStamp Node::next_scene_stamp() {
    SceneStamp st;
    st.counter = ++scene_clock_;
    if (st.counter == 0) st.counter = ++scene_clock_;   // 0 means no cue
    st.origin  = crc32_sku(identity_.sku.c_str());
    return st;
}

bool Node::scene_recall(uint8_t slot) {
    if (slot == 0) return false;
    handle_scene(SceneOp::Recall, slot, next_scene_stamp(), nullptr);
    return true;
}

bool Node::scene_store(uint8_t slot) {
    if (!valid_store_slot(slot)) return false;
    handle_scene(SceneOp::Store, slot, next_scene_stamp(), nullptr);
    return true;
}

bool Node::scene_links(uint8_t slot, SceneLinkCb cb, void* ctx) {
    if (!valid_store_slot(slot) || !(scene_status_.slots & (1u << (slot - 1)))) return false;
    char key[16];
    scene_key(slot, key, sizeof(key));
    uint32_t version = 0;
    ConnectionList list;
    if (!read_connections(storage_, key, version, list, [] { return ConnectionId{}; })) return false;
    for (const auto& c : list) cb(c.dest.c_str(), c.source_sku.c_str(), c.source.c_str(), ctx);
    return true;
}

// A cue from the host (from == nullptr) or a peer. Each node forwards a cue
// the first time it sees it, so it reaches the whole universe even when the
// mesh is not fully connected; a node that misses it gets it from a digest.
void Node::handle_scene(SceneOp op, uint8_t slot, const SceneStamp& stamp,
                        const PeerConnection* from) {
    if (SceneStamp::later(stamp.counter, scene_clock_)) scene_clock_ = stamp.counter;

    MsgScene msg;
    msg.op    = op;
    msg.slot  = slot;
    msg.stamp = stamp;

    if (op == SceneOp::Recall) {
        if (!stamp.newer_than(scene_cue_.stamp)) return;
        log("Scene: recall %u", static_cast<unsigned>(slot));
        scene_cue_.slot  = slot;
        scene_cue_.stamp = stamp;
        send_scene(msg, from);
        apply_scene();
    } else if (op == SceneOp::Store) {
        // Slots this node cannot hold are neither stored nor forwarded: the
        // nodes that hold them have the cue from the sender directly.
        if (!valid_store_slot(slot)) return;
        if (!stamp.newer_than(scene_stored_[slot - 1])) return;
        log("Scene: store %u", static_cast<unsigned>(slot));
        scene_stored_[slot - 1] = stamp;
        persist_scenes();       // the clock
        send_scene(msg, from);
        store_scene(slot);
    }
}

void Node::merge_scene_cue(const SceneCue& cue) {
    if (cue.stamp.empty() || cue.slot == 0) return;
    if (SceneStamp::later(cue.stamp.counter, scene_clock_)) scene_clock_ = cue.stamp.counter;
    if (!cue.stamp.newer_than(scene_cue_.stamp)) return;
    log("Scene: catching up with recall %u", static_cast<unsigned>(cue.slot));
    scene_cue_ = cue;
    apply_scene();
}

// Make our connections those of our slot of the current cue: remove the ones
// it does not have, then make the ones it has (removing first frees room on
// params that change source). A connection whose param of ours is gone is
// skipped; one whose source is gone is made anyway and resumes if it returns.
void Node::apply_scene() {
    const uint8_t slot = scene_cue_.slot;
    scene_applied_ = scene_cue_.stamp;

    SceneStatus st = scene_status_;
    st.current = slot;
    st.skipped = 0;

    char key[16];
    ConnectionList scene;
    uint32_t version = 0;
    bool have = false;
    if (valid_store_slot(slot) && (scene_status_.slots & (1u << (slot - 1)))) {
        scene_key(slot, key, sizeof(key));
        have = read_connections(storage_, key, version, scene, [] { return ConnectionId{}; });
    }
    if (!have) {
        log("Scene %u: no slot here, connections kept", static_cast<unsigned>(slot));
        st.state = SceneState::Missing;
        persist_scenes();
        set_scene_status(st, SceneOp::Recall, slot);
        return;
    }

    // Ours become the slot's: the ones it doesn't have go, the ones it has
    // come back (matched by their ends, with the id, links and transforms
    // they had when it was stored). One whose end of ours is gone is made
    // anyway but counted as skipped: it waits for its param, as one whose
    // source is gone waits for the source.
    unsigned removed = 0, added = 0, skipped = 0;
    for (size_t i = connections_.size(); i > 0; --i) {
        const Connection& c = connections_[i - 1];
        bool kept = false;
        for (const auto& sc : scene)
            kept = kept || sc.same_ends(c.dest.c_str(), c.source_sku.c_str(), c.source.c_str());
        if (kept) continue;
        connections_.erase(connections_.begin() + static_cast<ptrdiff_t>(i - 1));
        ++removed;
    }
    for (auto& sc : scene) {
        if (!local_params_.resolve(sc.dest.c_str())) ++skipped;
        if (Connection* c = find_connection(sc.dest.c_str(), sc.source_sku.c_str(), sc.source.c_str())) {
            if (c->links != sc.links) c->links = sc.links;   // its links and transforms as stored
            continue;
        }
        if (sc.id.empty()) sc.id = next_connection_id();
        if (connections_.push_back(sc)) ++added;
    }
    applying_scene_ = true;
    relink(EndOrigin::Outside, true);
    applying_scene_ = false;

    log("Scene %u applied: -%u +%u, %u skipped", static_cast<unsigned>(slot),
        removed, added, skipped);
    st.state   = SceneState::Applied;
    st.skipped = static_cast<uint8_t>(skipped > 255 ? 255 : skipped);
    set_scene_status(st, SceneOp::Recall, slot);
    persist_scenes();
}

void Node::store_scene(uint8_t slot) {
    char key[16];
    scene_key(slot, key, sizeof(key));
    if (!write_connections(storage_, key, conn_version_, connections_)) {
        log("Scene %u: could not write the slot", static_cast<unsigned>(slot));
        return;
    }
    log("Scene %u stored: %u connections", static_cast<unsigned>(slot),
        static_cast<unsigned>(connections_.size()));

    SceneStatus st = scene_status_;
    st.slots |= 1u << (slot - 1);
    // Our connections are now our slot of the current scene
    if (slot == scene_cue_.slot) {
        st.state   = SceneState::Applied;
        st.skipped = 0;
    }
    set_scene_status(st, SceneOp::Store, slot);
    persist_scenes();
}

void Node::scene_touched() {
    if (applying_scene_ || scene_status_.state != SceneState::Applied) return;
    SceneStatus st = scene_status_;
    st.state = SceneState::Modified;
    set_scene_status(st, SceneOp::Status, st.current);
    persist_scenes();
}

void Node::set_scene_status(const SceneStatus& st, SceneOp op, uint8_t slot) {
    const bool changed = st != scene_status_;
    scene_status_ = st;
    if (changed) redeclare();   // the status travels in our declaration
    if (scene_cb_ && (changed || op != SceneOp::Status)) {
        scene_cb_(op, slot, scene_status_, scene_ctx_);
    }
}

void Node::send_scene(const MsgScene& msg, const PeerConnection* except) {
    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_scene(buf,
                              ++seq_, msg); });
    if (len == 0) return;
    auto payload = etl::span<const uint8_t>(encode_buf_.data(), len);
    for (auto& peer : peers_) {
        if (&peer == except) continue;
        if (peer.socket != INVALID_SOCKET_HANDLE && peer.hello_received) {
            send_framed(peer.socket, payload);
        }
    }
}

// --- Phase ---
//
// Storage: "phase" holds [1] format (1), [1] phase, [4] counter, [4] origin,
// [1] pinned, [1] pinned phase (integers LE).

bool Node::set_phase(Phase p) {
    PhaseCue cue;
    cue.phase = p;
    cue.stamp = next_scene_stamp();
    handle_phase(cue, nullptr);
    return true;
}

void Node::pin_phase(bool pinned, Phase p) {
    const Phase before = phase();
    phase_pinned_ = pinned;
    pinned_phase_ = p;
    persist_phase();
    if (phase() != before) phase_changed(before);
}

// A cue from the host (from == nullptr), a peer's PHASE, or its HELLO or
// DIGEST. Forwarded once by each node it is new to, like a scene cue; a node
// that misses it gets it from a digest.
void Node::handle_phase(const PhaseCue& cue, const PeerConnection* from) {
    if (cue.stamp.empty()) return;
    if (SceneStamp::later(cue.stamp.counter, scene_clock_)) scene_clock_ = cue.stamp.counter;
    if (!cue.stamp.newer_than(phase_cue_.stamp)) return;
    const Phase before = phase();
    phase_cue_ = cue;
    persist_phase();
    persist_scenes();                                  // the clock
    MsgPhase msg;
    msg.cue = cue;
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_phase(buf, ++seq_, msg); });
    if (len > 0) {
        const auto payload = etl::span<const uint8_t>(encode_buf_.data(), len);
        for (auto& peer : peers_)
            if (&peer != from && peer.socket != INVALID_SOCKET_HANDLE && peer.hello_received)
                send_framed(peer.socket, payload);
    }
    if (phase() != before) phase_changed(before);
    else log("Phase: the universe is in %s (this node stays in %s)",
             to_string(cue.phase), to_string(phase()));
}

void Node::phase_changed(Phase before) {
    log("Phase: %s (was %s)", to_string(phase()), to_string(before));
    if (phase() == Phase::Preparation) {
        // Back to showing everything: look around again, so nodes we did not
        // call in presentation are found and called
        mdns_.browse("_dataflou._tcp.local.");
    }
    topology_changed();
    if (phase_cb_) phase_cb_(phase(), phase_ctx_);
}

void Node::load_phase() {
    phase_cue_ = PhaseCue{};
    phase_pinned_ = false;
    pinned_phase_ = Phase::Preparation;
    uint8_t b[12];
    size_t len = 0;
    if (storage_.read("phase", etl::span<uint8_t>(b), len) && len >= 12 && b[0] == 1 && b[1] <= 1) {
        phase_cue_.phase         = static_cast<Phase>(b[1]);
        phase_cue_.stamp.counter = get_u32(b + 2);
        phase_cue_.stamp.origin  = get_u32(b + 6);
        phase_pinned_            = b[10] != 0;
        pinned_phase_            = b[11] == 1 ? Phase::Presentation : Phase::Preparation;
    }
}

void Node::persist_phase() {
    uint8_t b[12];
    b[0] = 1;
    b[1] = static_cast<uint8_t>(phase_cue_.phase);
    put_u32(b + 2, phase_cue_.stamp.counter);
    put_u32(b + 6, phase_cue_.stamp.origin);
    b[10] = phase_pinned_ ? 1 : 0;
    b[11] = static_cast<uint8_t>(pinned_phase_);
    storage_.write("phase", etl::span<const uint8_t>(b, sizeof(b)));
}

// --- Its state, to move it ---

void Node::save_state() {
    // Not started, nothing is loaded yet: what storage holds is the state
    // (writing would put an empty list over its connections)
    if (!running_) return;
    persist_world(true);
    persist_scenes();
    persist_phase();
    persist_decl_version();
}

bool Node::state_key(size_t i, etl::string<16>& key) {
    static const char* const fixed[] = { "connections", "decl", "phase", "scenes" };
    constexpr size_t n = sizeof(fixed) / sizeof(fixed[0]);
    if (i < n) {
        key = fixed[i];
        return true;
    }
    if (i - n >= DATAFLOU_MAX_SCENES) return false;
    char k[16];
    scene_key(static_cast<uint8_t>(i - n + 1), k, sizeof(k));
    key = k;
    return true;
}

} // namespace dataflou
