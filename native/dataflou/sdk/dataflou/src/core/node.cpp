// node.cpp — the Node: lifecycle, role and universe, local params, the
// visualizer's monitors, callbacks, helpers. The rest of Node is in
// node_peers.cpp (links), node_messages.cpp (what arrives),
// node_connections.cpp, node_streams.cpp (values) and node_storage.cpp.

#include "node_internal.h"

namespace dataflou {

Node::Node(ITcp& tcp, IMdns& mdns, IClock& clock, IStorage& storage, IUdp& udp)
    : tcp_(tcp), mdns_(mdns), clock_(clock), storage_(storage), udp_(udp)
{
    // Out of memory, it stays empty: encode() grows it when a message comes
    encode_buf_.resize(ENCODE_BUF_START);
}

// --- Our own entry in the world view ---

// The desktop keeps a copy of our tree in our world entry: the visualizer
// reads every node's tree from there. A board doesn't: nothing reads it
// (a declaration about us is made from local_params_, and a connection from
// one of our params to another finds its source there), and the copy was
// remade on every connection change.
#ifndef DATAFLOU_SLIM_WORLDVIEW
// A write-only param's value stays out of the copy: unknown
static void hide_unreadable(ParamNode* n) {
    if (n->meta.kind == ParamKind::Param && !readable(n->meta.access)) {
        n->value = ParamValue{};
        n->value.tag = n->meta.type;
        n->value.unknown = true;
    }
    for (auto* child : n->children) hide_unreadable(child);
}
#endif

void Node::mirror_own_tree(NodeEntry& self) {
#ifdef DATAFLOU_SLIM_WORLDVIEW
    self.params.clear();
#else
    self.params = local_params_;
    hide_unreadable(self.params.root());
#endif
}

// --- Role ---

void Node::set_role(NodeRole role) {
#ifdef DATAFLOU_SOURCE_ONLY
    (void)role; // built as a source
#else
    role_ = role;
#endif
}

// What this node may tell its peers about: everything it knows, or for a
// satellite, itself only (it keeps others' identities, not their trees, and
// relays nothing).
WorldView::VersionVector Node::relayable_versions() const {
    auto vv = world_.version_vector();
    if (role_ == NodeRole::Satellite) {
        WorldView::VersionVector own;
        auto it = vv.find(identity_.sku);
        if (it != vv.end()) own[it->first] = it->second;
        return own;
    }
    return vv;
}

// One of our connections takes from that node.
bool Node::listens_to(const char* sku) const {
    for (const auto& c : connections_)
        if (c.source_sku == sku) return true;
    return false;
}

// --- Universe ---

void Node::set_universe(const char* name) {
    etl::string<32> old = universe_;
    universe_.assign(name, std::min(std::strlen(name),
                                    static_cast<size_t>(universe_.max_size())));
    // Its nodes are ours now, not another universe's
    for (size_t i = 0; i < other_universes_.size();) {
        if (other_universes_[i].universe == universe_)
            other_universes_.erase(other_universes_.begin() + static_cast<ptrdiff_t>(i));
        else
            ++i;
    }
    universes_changed();

    if (!running_ || old == universe_) return;

    log("Universe changed: %s -> %s — purging", old.c_str(), universe_.c_str());

    // 1. Disconnect all peers
    for (auto& peer : peers_) {
        disconnect_peer(peer);
    }
    peers_.clear();
    pending_peers_.clear();

    // 2. Clear streaming state
    stream_targets_.clear();
    inbound_stream_.clear();

    // 3. Purge world view (keep only local node)
    Vector<etl::string<36>> to_remove;
    for (const auto& entry : world_.nodes()) {
        if (!entry.is_local) {
            to_remove.push_back(entry.identity.sku);
        }
    }
    for (const auto& sku : to_remove) {
        world_.remove_node(sku.c_str());
        ++world_gen_;
    }

    // Scenes and the phase belong to the universe: the host moved storage there already
    load_scenes();
    load_phase();
    load_halt();

    // 4. Re-advertise mDNS with new universe
    mdns_.stop();

    etl::string<8> sku_short;
    if (identity_.sku.size() >= 8) {
        sku_short.assign(identity_.sku.c_str(), 8);
    } else {
        sku_short = identity_.sku;
    }
    etl::string<128> txt_sku;
    txt_sku = "sku=";
    txt_sku += identity_.sku;

    char ver_buf[16];
    snprintf(ver_buf, sizeof(ver_buf), "ver=%u", identity_.version);
    etl::string<32> txt_ver = ver_buf;

    etl::string<16> txt_core_ver;
    txt_core_ver = "core_ver=" DATAFLOU_VERSION;

    etl::string<48> txt_univ;
    txt_univ = "univ=";
    txt_univ += universe_;

    char started_buf[24];
    snprintf(started_buf, sizeof(started_buf), "started=%lld",
             static_cast<long long>(std::time(nullptr)));
    etl::string<32> txt_started = started_buf;

    // The role, so a node knows a satellite before calling it (absent: full)
    etl::string<16> txt_role;
    if (role_ != NodeRole::Full) { txt_role = "role="; txt_role += to_string(role_); }

    const char* txt[10];
    int txt_count = 0;
    txt[txt_count++] = txt_sku.c_str();
    txt[txt_count++] = txt_ver.c_str();
    txt[txt_count++] = txt_core_ver.c_str();
    txt[txt_count++] = txt_univ.c_str();
    txt[txt_count++] = txt_started.c_str();
    if (!txt_role.empty()) txt[txt_count++] = txt_role.c_str();
    for (const auto& kv : extra_txt_) {
        if (txt_count < 10) txt[txt_count++] = kv.c_str();
    }

    etl::string<64> service_name;
    service_name = identity_.label.c_str();
    service_name += "-";
    service_name += sku_short;

    mdns_.advertise(service_name.c_str(), "_dataflou._tcp.local.",
                    listen_port_, txt, txt_count);
    mdns_.browse("_dataflou._tcp.local.");
    log("mDNS: re-advertising '%s' (universe: %s)", service_name.c_str(), universe_.c_str());

    // 5. Persist now (overwrites old universe data)
    world_marker_written_ = false;
    persist_world(true);

    // 6. New declaration version so new peers get a fresh declare
    redeclare();
}

// --- Lifecycle ---

void Node::start() {
    // Stream ids start somewhere else each run: a receiver that still knows
    // our last run's ids is unlikely to take a new stream for an old one
    clock_ref_ = crc32_sku(identity_.sku.c_str());
    clock_synced_ = false;
    clock_offset_ms_ = 0;
    clock_samples_ = 0;
    clock_started_ms_ = clock_.millis();
    next_stream_id_ = static_cast<uint16_t>(1 + (clock_.millis() ^ crc32_sku(identity_.sku.c_str())) % STREAM_ID_MAX);
    // Load persisted world from storage
    // The scene clock first: connections saved before 9.0 get their ids from it
    load_scenes();
    load_phase();
    log("start: load_persisted_world");
    load_persisted_world();

    // Our declarations go on numbering from where the last run stopped: a
    // copy of an older declaration kept by another node must not win over
    // this run's because the count started again at 1.
    {
        uint8_t b[4];
        size_t n = 0;
        if (storage_.read("decl", etl::span<uint8_t>(b), n) && n == 4) {
            const uint32_t last = uint32_t(b[0]) | (uint32_t(b[1]) << 8) |
                                  (uint32_t(b[2]) << 16) | (uint32_t(b[3]) << 24);
            decl_version_ += last;
        }
        persist_decl_version();
    }

    // Add ourselves to the world view
    log("start: upsert_node");
    auto* self = world_.upsert_node(identity_.sku.c_str());
    if (self) {
        self->identity = identity_;
        self->decl_version = decl_version_;
        self->is_local = true;
        self->role = role_;
        self->max_frame = max_frame();
        self->online = true;
        self->first_seen_ms = clock_.millis();
        self->last_seen_ms = self->first_seen_ms;
        self->scene = scene_status_;
        mirror_own_tree(*self);
        ++world_gen_;
    }

    // Bind TCP listener on ephemeral port
    log("start: tcp_listen");
    listener_ = tcp_.listen(0);
    if (listener_ == INVALID_SOCKET_HANDLE) {
        log("Failed to bind TCP listener");
        return;
    }
    listen_port_ = tcp_.local_port(listener_);
    log("start: tcp listening on %u", listen_port_);

    // Advertise via mDNS
    etl::string<8> sku_short;
    if (identity_.sku.size() >= 8) {
        sku_short.assign(identity_.sku.c_str(), 8);
    } else {
        sku_short = identity_.sku;
    }
    etl::string<128> txt_sku;
    txt_sku = "sku=";
    txt_sku += identity_.sku;

    etl::string<32> txt_ver;
    // Simple itoa for version
    char ver_buf[16];
    snprintf(ver_buf, sizeof(ver_buf), "ver=%u", identity_.version);
    txt_ver = ver_buf;

    etl::string<16> txt_core_ver;
    txt_core_ver = "core_ver=" DATAFLOU_VERSION;

    etl::string<48> txt_univ;
    txt_univ = "univ=";
    txt_univ += universe_;

    etl::string<32> txt_started;
    {
        char buf[24];
        snprintf(buf, sizeof(buf), "started=%lld",
                 static_cast<long long>(std::time(nullptr)));
        txt_started = buf;
    }

    // The role, so a node knows a satellite before calling it (absent: full)
    etl::string<16> txt_role;
    if (role_ != NodeRole::Full) { txt_role = "role="; txt_role += to_string(role_); }

    const char* txt[10];
    int txt_count = 0;
    txt[txt_count++] = txt_sku.c_str();
    txt[txt_count++] = txt_ver.c_str();
    txt[txt_count++] = txt_core_ver.c_str();
    txt[txt_count++] = txt_univ.c_str();
    txt[txt_count++] = txt_started.c_str();
    if (!txt_role.empty()) txt[txt_count++] = txt_role.c_str();
    for (const auto& kv : extra_txt_) {
        if (txt_count < 10) txt[txt_count++] = kv.c_str();
    }

    etl::string<64> service_name;
    service_name = identity_.label.c_str();
    service_name += "-";
    service_name += sku_short;

    mdns_.advertise(service_name.c_str(), "_dataflou._tcp.local.",
                    listen_port_, txt, txt_count);
    log("mDNS: advertising '%s' on _dataflou._tcp port %u (universe: %s)",
        service_name.c_str(), listen_port_, universe_.c_str());
    mdns_.browse("_dataflou._tcp.local.");

    // Bind UDP socket on TCP port + 1
    udp_socket_ = udp_.bind(listen_port_ + 1);
    if (udp_socket_ == INVALID_UDP_HANDLE) {
        log("Warning: failed to bind UDP socket on port %u", listen_port_ + 1);
    }

    running_ = true;
    last_digest_ms_ = clock_.millis();
    last_persist_ms_ = last_digest_ms_;

    log("Node started: %s (port %u, udp %u)", identity_.label.c_str(),
        listen_port_, listen_port_ + 1);

    // Our connections: their links from the trees as declared so far, and
    // the streams they ask for (sent as their sources join)
    if (self) { self->connections = connections_; self->conn_version = conn_version_; }
    relink();
}

void Node::poll() {
    if (!running_) return;
    poll_mdns();
    poll_tcp_accept();
    poll_tcp_peers();
    poll_timeouts();
    poll_digest();
    poll_persist();
    poll_stream_keepalive();
    poll_monitors();
    poll_stream();
    poll_held();
    poll_destinations();
    if (!listening_.empty()) make_listened();
    poll_populations();
    poll_locates();
    poll_glides();
    poll_forget();
    poll_connection_limit();
    poll_presentation_links();
    poll_clock();
    poll_seeds();

    // A big message has gone: its room goes back
    if (encode_buf_.size() > ENCODE_BUF_START) {
        encode_buf_ = Vector<uint8_t>();
        encode_buf_.resize(ENCODE_BUF_START);
    }
}

void Node::stop() {
    if (!running_) return;
    running_ = false;

    // Send LEAVE to all peers
    uint8_t buf[256];
    size_t len = encode_leave(etl::span<uint8_t>(buf), ++seq_);
    if (len > 0) {
        for (auto& peer : peers_) {
            if (peer.socket != INVALID_SOCKET_HANDLE) {
                send_framed(peer.socket, etl::span<const uint8_t>(buf, len));
            }
        }
    }

    // Close all connections
    for (auto& peer : peers_) {
        if (peer.socket != INVALID_SOCKET_HANDLE) {
            tcp_.close(peer.socket);
            peer.socket = INVALID_SOCKET_HANDLE;
        }
    }
    peers_.clear();

    if (listener_ != INVALID_SOCKET_HANDLE) {
        tcp_.close(listener_);
        listener_ = INVALID_SOCKET_HANDLE;
    }

    if (udp_socket_ != INVALID_UDP_HANDLE) {
        udp_.close(udp_socket_);
        udp_socket_ = INVALID_UDP_HANDLE;
    }

    mdns_.stop();
    persist_world();

    log("Node stopped");
}

// --- Dynamic param declaration ---

// Why a declaration was refused, when it is its path (else: out of memory)
void Node::refused_declaration(const char* path, const ParamMetaCore* meta) {
    const char* p = path && *path == '/' ? path + 1 : path;
    const size_t len = p ? std::strlen(p) : 0;
    if (meta && meta->kind == ParamKind::Param && meta->type == ParamType::Array &&
        !valid_array(meta->of, meta->size))
        log("Declaration refused: %s, an array of %u %s (1 to %u of them)", path ? path : "",
            static_cast<unsigned>(meta->size), to_string(meta->of),
            static_cast<unsigned>(max_array_size(meta->of)));
    else if (len > kMaxPathLength)
        log("Declaration refused: a path of %u bytes, at most %u (%.40s...)",
            static_cast<unsigned>(len), static_cast<unsigned>(kMaxPathLength), p);
    else
        log("Declaration refused: %s (out of memory)", path ? path : "");
}

ParamNode* Node::declare_group(const char* path, const ParamMeta& meta) {
    ParamNode* node = local_params_.declare_group(path, meta);
    if (node) {
        redeclare();
    } else {
        refused_declaration(path);
    }
    return node;
}

ParamNode* Node::declare_param(const char* path, const ParamMeta& meta) {
    ParamNode* node = local_params_.declare_param(path, meta);
    if (node) {
        redeclare();
    } else {
        refused_declaration(path, &meta);
    }
    return node;
}

// --- Local parameter access ---

void Node::fire(const char* path) {
    ParamValue v;
    v.tag = ParamType::Trigger;
    set_value(path, v);
}

void Node::set_value(const char* path, const ParamValue& val) {
    set_value_at(path, val, 0);
}

void Node::set_value_at(const char* path, const ParamValue& val, uint64_t at) {
    // A population's gate: its edges are kept, so none is lost between
    // sends; a param whose every sample counts: each of them
    ParamNode* n = local_params_.resolve(path);
    const bool gate = n && is_gate(n);
    const bool was = gate && n->value.b;
    // A source's instance: its id before its gate (or no instance, ids source)
    if (gate && !was && val.tag == ParamType::Bool && val.b && !give_id(path, n)) return;
    const bool written = local_params_.set_value(path, val);
    // Its time (9.3): on the param, or on the array one element of it is
    size_t index = 0;
    if (written)
        if (ParamNode* stamped = n ? n : resolve_element(local_params_, path, index)) stamped->stamp = at;
    if (n && !gate) id_written(n);
    if (gate && was && !n->value.b) slot_ended(n);
    if (n && ((gate && n->value.b != was) || (n->meta.every && !gate))) {
        if (Written* w = written_.emplace_back()) {
            w->node = n;
            w->value = n->value;
            w->epoch = n->change_epoch;
            w->at = clock_.millis();
            w->stamp = at;
        }
    }
    // A local write wins over a glide in progress
    if (*path == '/') ++path;
    for (size_t i = 0; i < glides_.size(); ++i) {
        if (glides_[i].path == path) {
            glides_.erase(glides_.begin() + static_cast<ptrdiff_t>(i));
            break;
        }
    }
}

const ParamValue* Node::get_value(const char* path) const {
    return local_params_.get_value(path);
}

uint64_t Node::value_time(const char* path) const {
    if (const ParamNode* n = local_params_.resolve(path)) return n->stamp;
    size_t index = 0;
    if (const ParamNode* arr = resolve_element(local_params_, path, index)) return arr->stamp;
    return 0;
}

bool Node::remove_param(const char* path) {
    if (!local_params_.remove(path)) return false;
    redeclare();
    return true;
}

void Node::persist_decl_version() {
    const uint8_t b[4] = { uint8_t(decl_version_), uint8_t(decl_version_ >> 8),
                           uint8_t(decl_version_ >> 16), uint8_t(decl_version_ >> 24) };
    storage_.write("decl", etl::span<const uint8_t>(b, 4));
}

void Node::release_declarations() {
    if (!decl_hold_ || --decl_hold_) return;
    if (!decl_held_) return;
    decl_held_ = false;
    redeclare();
}

void Node::redeclare() {
    if (decl_hold_) {                // said once, at the release
        decl_held_ = true;
        return;
    }
    ++decl_version_;
    if (!running_) return; // start() publishes the initial declaration
    persist_decl_version();
    sync_local_to_world();
    for (auto& peer : peers_) {
        if (peer.hello_received && peer.socket != INVALID_SOCKET_HANDLE) {
            send_declare_self(peer);
        }
    }
    topology_changed();
    relink();   // a param that came or went: the links that reach it
}

void Node::topology_changed() {
    monitors_stale_ = true;
    if (topo_cb_) topo_cb_(topo_ctx_);
}

// --- Visualizer monitoring ---

void Node::set_monitoring(bool on) {
    if (on == monitoring_) return;
    monitoring_ = on;
    if (on) {
        monitors_stale_ = true;
        log("Monitoring remote values: on");
    } else {
        stop_monitors();
        log("Monitoring remote values: off");
    }
}

void Node::stop_monitors() {
    for (const auto& m : monitors_) {
        send_stream_stop(m.sku.c_str(), m.path.c_str(), "", true);
        forget_stream_name(m.sid);
    }
    monitors_.clear();
}

// Collect "a/b/c" paths of every param under `node` (world view tree),
// whole: `prefix` is one buffer for the walk (out of memory, a param is
// skipped rather than named short).
template <typename WorldNode, typename Fn>
static void for_each_param_path(const WorldNode* node, Vector<char>& prefix, Fn&& fn) {
    for (const auto* child : node->children) {
        const size_t mark = prefix.size();
        bool ok = prefix.empty() || prefix.push_back('/');
        for (size_t i = 0; ok && i < child->meta.name.size(); ++i) ok = prefix.push_back(child->meta.name.c_str()[i]);
        if (ok && child->meta.kind == ParamKind::Param) {
            if (prefix.push_back('\0')) fn(static_cast<const char*>(prefix.data()));
        } else if (ok) {
            for_each_param_path(child, prefix, fn);
        }
        prefix.resize(mark);
    }
}

void Node::poll_monitors() {
    if (!monitoring_) return;
    const uint64_t now = clock_.millis();
    const bool keepalive = (now - last_monitor_ms_) >= STREAM_KEEPALIVE_INTERVAL_MS;
    if (!monitors_stale_ && !keepalive) return;

    // Every param of every connected remote node, except those a local
    // subscription already streams (their values reach the world view anyway).
    Vector<MonitorEntry>& wanted = monitors_wanted_;
    wanted.clear();
    for (const auto& entry : world_.nodes()) {
        if (entry.is_local || !entry.online) continue;
        const auto* peer = find_peer_by_sku(entry.identity.sku.c_str());
        if (!peer || !peer->hello_received || peer->socket == INVALID_SOCKET_HANDLE) continue;
        Vector<char> prefix;
        for_each_param_path(entry.params.root(), prefix, [&](const char* path) {
            for (const auto& ie : inbound_stream_)
                if (ie.source_sku == entry.identity.sku && ie.source_path == path) return;
            MonitorEntry m;
            m.sku = entry.identity.sku;
            m.sku_hash = crc32_sku(m.sku.c_str());
            m.path = path;
            wanted.push_back(m);                    // best effort: out of memory, not watched
        });
    }

    auto find = [](Vector<MonitorEntry>& list, const MonitorEntry& m) -> MonitorEntry* {
        for (auto& x : list)
            if (x.sku_hash == m.sku_hash && x.sku == m.sku && x.path == m.path) return &x;
        return nullptr;
    };
    // Each keeps its number; a new one gets one of ours, as every stream in
    for (auto& m : wanted) {
        if (const MonitorEntry* had = find(monitors_, m)) { m.sid = had->sid; m.waiting = had->waiting; continue; }
        m.sid = new_inbound_sid();
        if (m.sid) name_stream(m.sku.c_str(), m.sid, m.path, Text());
    }
    for (const auto& m : monitors_)
        if (!find(wanted, m)) {
            send_stream_stop(m.sku.c_str(), m.path.c_str(), "", true);
            forget_stream_name(m.sid);
        }
    for (auto& m : wanted)
        if (m.sid && (keepalive || !find(monitors_, m))) {
            send_stream_request(m.sku.c_str(), m.path.c_str(), "", MONITOR_RATE_HZ, true, m.sid);
            m.waiting = true;
        }

    monitors_ = wanted;
    monitors_stale_ = false;
    if (keepalive) last_monitor_ms_ = now;
}

void Node::sync_local_to_world() {
    auto* self = world_.find_node(identity_.sku.c_str());
    if (self) {
        self->identity = identity_;
        self->decl_version = decl_version_;
        self->scene = scene_status_;
        mirror_own_tree(*self);
        ++world_gen_;
    }
}

// --- Admin ---

void Node::flush_node(const char* sku) {
    world_.remove_node(sku);
    ++world_gen_;
    send_flush(sku);
    persist_world();
    log("Flushed node: %s", sku);
}

// --- Events ---

void Node::on_peer_joined(PeerCb cb, void* ctx) {
    peer_joined_cb_ = cb;
    peer_joined_ctx_ = ctx;
}

void Node::on_peer_left(PeerCb cb, void* ctx) {
    peer_left_cb_ = cb;
    peer_left_ctx_ = ctx;
}

void Node::on_topology_changed(TopologyCb cb, void* ctx) {
    topo_cb_ = cb;
    topo_ctx_ = ctx;
}

void Node::on_log(LogCb cb, void* ctx) {
    log_cb_ = cb;
    log_ctx_ = ctx;
}

void Node::on_param_admin(ParamAdminCb cb, void* ctx) {
    param_admin_cb_ = cb;
    param_admin_ctx_ = ctx;
}

void Node::on_blob(BlobCb cb, void* ctx) {
    blob_cb_ = cb;
    blob_ctx_ = ctx;
}

void Node::on_blob_req(BlobProviderCb cb, void* ctx) {
    blob_provider_cb_ = cb;
    blob_provider_ctx_ = ctx;
}

void Node::on_identify(IdentifyCb cb, void* ctx) {
    identify_cb_ = cb;
    identify_ctx_ = ctx;
}

void Node::on_scene(SceneCb cb, void* ctx) {
    scene_cb_  = cb;
    scene_ctx_ = ctx;
}

void Node::identify() {
    if (!running_) return;
    // Peers form a full mesh, so a direct send reaches every node.
    uint8_t buf[128];
    size_t len = encode_identify(etl::span<uint8_t>(buf), ++seq_);
    if (len > 0) {
        for (auto& peer : peers_) {
            if (peer.hello_received && peer.socket != INVALID_SOCKET_HANDLE) {
                send_framed(peer.socket, etl::span<const uint8_t>(buf, len));
            }
        }
    }
    if (identify_cb_) identify_cb_(identity_.sku.c_str(), identify_ctx_);
}

// --- Internal: helpers ---

Node::PeerConnection* Node::find_peer_by_sku(const char* sku) {
    for (auto& peer : peers_) {
        if (!peer.retired && peer.sku == sku) return &peer;
    }
    return nullptr;
}

// A connection died. If the same node is reached by another connection (it
// came back, a board after a power cycle, before this one was found dead),
// the node has not left: only this socket goes, its streams and its online
// state stay. Returns true when the node did leave.
bool Node::connection_lost(PeerConnection& peer) {
    // It said it was closing on purpose: the node is still there
    if (peer.detached) {
        if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
        peer.socket = INVALID_SOCKET_HANDLE;
        disconnect_peer(peer);
        monitors_stale_ = true;   // its monitors go with the connection, asked anew when it is back
        log("%s closed its connection, and is still there", peer.sku.c_str());
        return false;
    }
    for (const auto& p : peers_) {
        if (&p != &peer && !p.retired && p.hello_received &&
            p.socket != INVALID_SOCKET_HANDLE && p.sku == peer.sku) {
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
            peer.socket = INVALID_SOCKET_HANDLE;
            log("Old connection to %s closed, a newer one stays", peer.sku.c_str());
            return false;
        }
    }
    auto* entry = world_.find_node(peer.sku.c_str());
    mark_offline(peer.sku.c_str());
    disconnect_peer(peer);
    // Back at once under its name on another port, it makes no new mDNS
    // event on a backend that keeps what it resolved: have it look again
    if (!peer.sku.empty()) mdns_.look_again(peer.sku.c_str());
    if (peer_left_cb_ && entry) peer_left_cb_(entry->identity, peer_left_ctx_);
    return true;
}

void Node::disconnect_peer(PeerConnection& peer) {
    if (peer.socket != INVALID_SOCKET_HANDLE) {
        tcp_.close(peer.socket);
        peer.socket = INVALID_SOCKET_HANDLE;
    }

    // Remove StreamTargets destined for the disconnecting peer
    if (!peer.sku.empty()) {
        for (size_t i = stream_targets_.size(); i > 0; --i) {
            if (stream_targets_[i - 1].dest_sku == peer.sku) {
                log("StreamTarget removed (peer disconnect): %s -> %s",
                    stream_targets_[i - 1].local_path.c_str(), peer.sku.c_str());
                stream_targets_.erase(stream_targets_.begin() + static_cast<ptrdiff_t>(i - 1));
            }
        }
    }
}

void Node::log(const char* fmt, ...) {
    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    if (log_cb_) {
        log_cb_(buf, log_ctx_);
    }
}

// --- CRC32 for SKU hashing ---

uint32_t Node::crc32_sku(const char* sku) {
    uint32_t crc = 0xFFFFFFFF;
    while (*sku) {
        crc ^= static_cast<uint8_t>(*sku++);
        for (int i = 0; i < 8; ++i) {
            crc = (crc >> 1) ^ (0xEDB88320 & (-(crc & 1)));
        }
    }
    return crc ^ 0xFFFFFFFF;
}

// --- Memory report ---

void Node::memory_report(void (*out)(const char* line, void* ctx), void* ctx) const {
    char line[160];
    size_t recv_room = 0, open = 0;
    for (const auto& p : peers_) {
        recv_room += p.recv_buf.capacity();
        open += p.socket != INVALID_SOCKET_HANDLE ? 1 : 0;
    }
    size_t world_params = 0, online = 0;
    for (const auto& e : world_.nodes()) {
        world_params += e.params.node_count();
        online += e.online ? 1 : 0;
    }
    snprintf(line, sizeof(line), "core %u bytes (peak %u, %u refused)",
             static_cast<unsigned>(Memory::used()), static_cast<unsigned>(Memory::peak()),
             static_cast<unsigned>(Memory::refusals()));
    out(line, ctx);
    snprintf(line, sizeof(line), "peers %u (%u open), receive buffers %u bytes, waiting %u",
             static_cast<unsigned>(peers_.size()), static_cast<unsigned>(open),
             static_cast<unsigned>(recv_room), static_cast<unsigned>(pending_peers_.size()));
    out(line, ctx);
    snprintf(line, sizeof(line), "world %u nodes (%u online), %u params; own %u params",
             static_cast<unsigned>(world_.nodes().size()), static_cast<unsigned>(online),
             static_cast<unsigned>(world_params), static_cast<unsigned>(local_params_.node_count()));
    out(line, ctx);
    snprintf(line, sizeof(line), "streams out %u, in %u; glides %u, grounds %u; monitors %u; encode %u bytes",
             static_cast<unsigned>(stream_targets_.size()), static_cast<unsigned>(inbound_stream_.size()),
             static_cast<unsigned>(glides_.size()), static_cast<unsigned>(dest_pending_.size()),
             static_cast<unsigned>(monitors_.size()), static_cast<unsigned>(encode_buf_.capacity()));
    out(line, ctx);
    // Stream packets dropped: under a number we didn't give (a stream we
    // stopped), or under one of ours from another source or path
    snprintf(line, sizeof(line), "stream packets dropped: %u unknown number, %u not that stream",
             static_cast<unsigned>(dbg_unnamed_), static_cast<unsigned>(dbg_foreign_));
    out(line, ctx);
}

} // namespace dataflou
