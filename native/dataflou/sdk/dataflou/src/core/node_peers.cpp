// node_peers.cpp — links to other nodes: discovery, TCP accept and I/O,
// sending, timeouts and digests, a transport with few connections,
// presentation, nodes on another protocol, forgetting.

#include "node_internal.h"

namespace dataflou {

// --- Internal: mDNS polling ---

void Node::poll_mdns() {
    MdnsEvent ev;
    while (mdns_.poll_event(ev)) {
        switch (ev.type) {
        case MdnsEvent::PeerFound:
            handle_peer_found(ev);
            break;
        case MdnsEvent::PeerLost:
            handle_peer_lost(ev);
            break;
        }
    }
}

void Node::handle_peer_found(const MdnsEvent& ev) {
    // Ignore events with missing identity
    if (ev.sku.empty() || ev.port == 0) return;

    // Ignore peers from a different universe, but remember it exists: a
    // node with a screen (a satellite) can show what is around
    if (ev.universe != universe_) {
        if (ev.universe.empty()) return;
        const uint64_t now = clock_.millis();
        for (auto& o : other_universes_)
            if (o.sku == ev.sku) {
                const bool moved = !(o.universe == ev.universe);
                o.universe = ev.universe;
                o.heard_ms = now;
                if (moved) universes_changed();
                return;
            }
        if (other_universes_.push_back({ ev.sku, ev.universe, now })) universes_changed();
        return;
    }

    // Ignore ourselves
    if (ev.sku == identity_.sku) return;

    // Another wire format (its mDNS record says another major, or 9.0 for
    // a 9.1): not called
    if (!same_wire_format(ev.core_ver.c_str(), ev.core_ver.size(), DATAFLOU_VERSION_MAJOR,
                          DATAFLOU_VERSION_MINOR)) {
        etl::string<64> name = ev.name;                  // "Label-sku._dataflou._tcp.local."
        const size_t dot = name.find("._");
        if (dot != etl::string<64>::npos) name.resize(dot);
        note_incompatible(ev.sku.c_str(), name.c_str(), ev.core_major, 0, ev.address.c_str(),
                          ev.port, ev.core_ver.c_str(), nullptr);
        return;
    }

    // Already connected? If the port changed (peer rebooted), reconnect.
    // The address alone is not compared: a connected peer's address comes
    // from the TCP socket (HELLO), which legitimately differs from what mDNS
    // reports for a peer on this machine (127.0.0.1 vs its LAN IP) or on a
    // multi-homed host — comparing it made such peers reconnect every few
    // seconds. A peer whose address really changed drops its TCP link and
    // is rediscovered after the peer timeout.
    if (auto* existing = find_peer_by_sku(ev.sku.c_str())) {
        if (existing->port != ev.port) {
            log("Peer %s port changed (%u -> %u), reconnecting",
                ev.sku.c_str(), existing->port, ev.port);
            auto* entry = world_.find_node(ev.sku.c_str());
            if (entry && !entry->is_local) {
                entry->decl_version = 0; // accept fresh DECLARE after reboot
            }
            disconnect_peer(*existing);
            for (size_t pi = 0; pi < peers_.size(); ++pi) {
                if (peers_[pi].sku == ev.sku) {
                    peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(pi));
                    break;
                }
            }
            // Fall through to reconnect below
        } else {
            return; // same port — already connected
        }
    }

    // Connection deduplication: lower SKU initiates outbound. In presentation
    // the node that needs the link calls, whatever the order: the one that
    // listens (its source may not know it is listened to: subscriptions
    // travel on links), and a satellite without its full node (full nodes
    // don't call satellites they have no business with).
    const bool calls_anyway = phase() == Phase::Presentation &&
        (listens_to(ev.sku.c_str()) ||
         (role_ == NodeRole::Satellite && !anchor() && wanted_in_presentation(ev.sku.c_str(), ev.role)));
    if (identity_.sku > ev.sku && !calls_anyway) {
        // We have the higher SKU — don't initiate, wait for them to connect
        log("Peer found (waiting for inbound): %s at %s:%u",
            ev.sku.c_str(), ev.address.c_str(), ev.port);
        // Cache their address so we can set it when their HELLO arrives
        if (!pending_peers_.full()) {
            bool already = false;
            for (auto& pp : pending_peers_) {
                if (pp.sku == ev.sku) { pp.address = ev.address; pp.port = ev.port; already = true; break; }
            }
            if (!already) {
                PendingPeer pp;
                pp.sku = ev.sku;
                pp.address = ev.address;
                pp.port = ev.port;
                pending_peers_.push_back(pp);
            }
        }
        return;
    }

    // In presentation, only the nodes that carry values (and a satellite's
    // one full node)
    if (phase() == Phase::Presentation && !wanted_in_presentation(ev.sku.c_str(), ev.role)) return;

    // A transport with few connections: keep the last one for a node we
    // have business with (we listen to it)
    if (const size_t limit = tcp_.connection_limit();
        limit && open_peers() + 1 >= limit && !listens_to(ev.sku.c_str())) {
        return;
    }

    log("Peer found (connecting): %s at %s:%u",
        ev.sku.c_str(), ev.address.c_str(), ev.port);

    // Connect outbound
    SocketHandle s = tcp_.connect(ev.address.c_str(), ev.port);
    if (s == INVALID_SOCKET_HANDLE) {
        log("Failed to connect to %s", ev.sku.c_str());
        mdns_.look_again(ev.sku.c_str());
        return;
    }

    if (!peers_.full()) {
        PeerConnection pc;
        pc.socket = s;
        pc.sku = ev.sku;
        pc.address = ev.address;
        pc.port = ev.port;
        pc.connect_started_ms = clock_.millis();
        peers_.push_back(pc);
    } else {
        tcp_.close(s);
    }
}

// universes_seen_: the universes of the other universes' nodes, once each
void Node::universes_changed() {
    universes_seen_.clear();
    for (const auto& o : other_universes_) {
        bool known = false;
        for (const auto& u : universes_seen_) known = known || u == o.universe;
        if (!known) universes_seen_.push_back(o.universe);
    }
}

void Node::handle_peer_lost(const MdnsEvent& ev) {
    for (size_t i = 0; i < other_universes_.size(); ++i)
        if (other_universes_[i].sku == ev.sku) {
            other_universes_.erase(other_universes_.begin() + static_cast<ptrdiff_t>(i));
            universes_changed();
            return;
        }
    // mDNS goodbye — mark peer offline but keep in world
    auto* entry = world_.find_node(ev.sku.c_str());
    if (entry && entry->online) {
        mark_offline(ev.sku.c_str());
        log("Peer offline (mDNS): %s", ev.sku.c_str());
        if (peer_left_cb_ && entry) {
            peer_left_cb_(entry->identity, peer_left_ctx_);
        }
        topology_changed();
    }
}

// --- Internal: TCP accept ---

void Node::poll_tcp_accept() {
    if (listener_ == INVALID_SOCKET_HANDLE) return;

    SocketHandle s = tcp_.accept(listener_);
    while (s != INVALID_SOCKET_HANDLE) {
        if (!peers_.full()) {
            PeerConnection pc;
            pc.socket = s;
            pc.opened_ms = clock_.millis();
            peers_.push_back(pc);
            log("Accepted inbound connection");
        } else {
            tcp_.close(s);
        }
        s = tcp_.accept(listener_);
    }
}

// --- Internal: TCP peer I/O ---

void Node::poll_tcp_peers() {
    uint8_t tmp[1024]; // fixed stack buffer for recv (not DATAFLOU_RECV_BUF_SIZE)

    for (size_t i = 0; i < peers_.size(); ) {
        auto& peer = peers_[i];
        if (peer.retired) {   // replaced by a newer connection: already closed
            peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
            continue;
        }

        // Check connecting peers
        if (!peer.hello_sent && peer.socket != INVALID_SOCKET_HANDLE) {
            if (!tcp_.is_connected(peer.socket)) {
                // A dial that doesn't complete (unreachable address, dropped
                // SYN, refused) is abandoned so the next mDNS answer retries.
                if (peer.connect_started_ms > 0 &&
                    clock_.millis() - peer.connect_started_ms > CONNECT_TIMEOUT_MS) {
                    log("Connect to %s at %s:%u did not complete, dropped",
                        peer.sku.c_str(), peer.address.c_str(), peer.port);
                    // Where mDNS said it is may be stale: looked up again
                    if (!peer.sku.empty()) mdns_.look_again(peer.sku.c_str());
                    disconnect_peer(peer);
                    peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
                    continue;
                }
                ++i;
                continue;
            }
            peer.connect_started_ms = 0;
            peer.opened_ms = clock_.millis();
            // Just connected — send HELLO
            log("Sending HELLO to peer %zu (fd=%d)", i, peer.socket);
            send_hello(peer);
            peer.hello_sent = true;
            log("HELLO sent OK");
        }

        // Receive data
        if (peer.socket == INVALID_SOCKET_HANDLE) {
            ++i;
            continue;
        }

        // What waits to be sent goes first; a peer whose backlog overflowed goes
        if (peer.broken) {
            log("Peer disconnected: %s", peer.sku.c_str());
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
            peer.socket = INVALID_SOCKET_HANDLE;
            const bool left = connection_lost(peer);
            peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
            if (left) topology_changed();
            continue;
        }
        if (!peer.send_buf.empty()) flush_sends(peer);

        // While it has more, up to TCP_READS_PER_POLL reads: a big frame (a
        // declaration of thousands of params) arrives in a few polls, not
        // one kilobyte per poll
        for (int round = 0; round < TCP_READS_PER_POLL; ++round) {
        if (peer.retired || peer.socket == INVALID_SOCKET_HANDLE) break;
        int n = tcp_.recv(peer.socket, etl::span<uint8_t>(tmp));
        if (n < 0) {
            // Connection lost
            log("Peer disconnected: %s", peer.sku.c_str());
            const bool left = connection_lost(peer);
            peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
            if (left) topology_changed();
            goto next_peer;
        }
        if (n == 0) break;
        {
            peer.last_msg_ms = clock_.millis();
            // tmp may hold more than recv_buf has room for: take it in turns,
            // processing frames in between, so no byte is lost.
            size_t j = 0;
            while (j < static_cast<size_t>(n)) {
                // The rest of a frame too big for recv_buf: discard it
                if (peer.skip_bytes > 0) {
                    const size_t k = std::min<size_t>(peer.skip_bytes, n - j);
                    peer.skip_bytes -= static_cast<uint32_t>(k);
                    j += k;
                    continue;
                }
                // recv_buf holds one frame at a time, allocated at its exact
                // size once its 4-byte length is known (no doubling on the
                // way up, which on a small board was the difference)
                const size_t at = peer.recv_buf.size();
                size_t want = 4;                    // the length first
                if (at >= 4) {
                    const uint32_t len =
                        (static_cast<uint32_t>(peer.recv_buf[0]) << 24) |
                        (static_cast<uint32_t>(peer.recv_buf[1]) << 16) |
                        (static_cast<uint32_t>(peer.recv_buf[2]) <<  8) |
                        (static_cast<uint32_t>(peer.recv_buf[3]));
                    want = 4 + static_cast<size_t>(len);
                    if (!peer.recv_buf.reserve(want)) {
                        // No room for this frame: skip it, keep the connection
                        log("Skipped a %u-byte frame from %s: out of memory (%u bytes in use)",
                            len, peer.sku.c_str(), static_cast<unsigned>(Memory::used()));
                        peer.skip_bytes = static_cast<uint32_t>(want - at);
                        peer.recv_buf.clear();
                        continue;
                    }
                }
                const size_t k = std::min<size_t>(want - at, n - j);
                if (!peer.recv_buf.resize(at + k)) {
                    log("Out of memory receiving from %s (%u bytes in use): connection closed",
                        peer.sku.c_str(), static_cast<unsigned>(Memory::used()));
                    const bool left = connection_lost(peer);
                    peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
                    if (left) topology_changed();
                    goto next_peer;
                }
                memcpy(peer.recv_buf.data() + at, tmp + j, k);
                j += k;

                // Process complete frames (length-prefixed)
                while (peer.recv_buf.size() >= 4) {
                    uint32_t payload_len =
                        (static_cast<uint32_t>(peer.recv_buf[0]) << 24) |
                        (static_cast<uint32_t>(peer.recv_buf[1]) << 16) |
                        (static_cast<uint32_t>(peer.recv_buf[2]) <<  8) |
                        (static_cast<uint32_t>(peer.recv_buf[3]));

                    if (payload_len > MAX_SANE_FRAME) {
                        // Corrupt frame — disconnect
                        log("Corrupt frame from %s (len %u)", peer.sku.c_str(), payload_len);
                        connection_lost(peer);
                        peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
                        topology_changed();
                        goto next_peer;
                    }

                    const size_t frame = 4 + static_cast<size_t>(payload_len);
                    if (frame > DATAFLOU_RECV_BUF_SIZE) {
                        // More than this node can hold (a big node's DECLARE
                        // on a small device): skip it, keep the connection.
                        // All of recv_buf is the start of this frame.
                        log("Skipped a %u-byte frame from %s (this node takes up to %u)",
                            payload_len, peer.sku.c_str(), static_cast<unsigned>(max_frame()));
                        peer.skip_bytes = static_cast<uint32_t>(frame - peer.recv_buf.size());
                        peer.recv_buf.clear();
                        break;
                    }

                    if (peer.recv_buf.size() < frame) {
                        break; // Incomplete frame
                    }

                    // Extract frame
                    handle_message(peer, etl::span<const uint8_t>(peer.recv_buf.data() + 4, payload_len));

                    // Remove consumed bytes
                    size_t remaining = peer.recv_buf.size() - frame;
                    if (remaining > 0) {
                        memmove(peer.recv_buf.data(),
                                peer.recv_buf.data() + frame,
                                remaining);
                    }
                    peer.recv_buf.resize(remaining);
                }
                // A big frame's room goes back once it is read
                if (peer.recv_buf.empty() && peer.recv_buf.capacity() > 4096) peer.recv_buf.shrink();
            }
        }
        if (n < static_cast<int>(sizeof(tmp))) break;   // drained for now
        }

        ++i;
        next_peer:;
    }
}

// --- Internal: sending ---

void Node::send_framed(SocketHandle s, etl::span<const uint8_t> payload) {
    const uint32_t len = static_cast<uint32_t>(payload.size());
    const uint8_t header[4] = { static_cast<uint8_t>((len >> 24) & 0xFF), static_cast<uint8_t>((len >> 16) & 0xFF),
                                static_cast<uint8_t>((len >>  8) & 0xFF), static_cast<uint8_t>( len        & 0xFF) };
    PeerConnection* peer = nullptr;
    for (auto& p : peers_)
        if (p.socket == s && !p.retired) { peer = &p; break; }
    if (!peer) {   // no peer of ours on it (closing): what goes, goes
        tcp_.send(s, etl::span<const uint8_t>(header, 4));
        tcp_.send(s, payload);
        return;
    }
    if (peer->broken) return;
    // Straight to the socket while nothing waits; the rest after what waits
    auto put = [&](const uint8_t* d, size_t size) {
        size_t at = 0;
        if (peer->send_buf.empty())
            while (at < size) {
                const int n = tcp_.send(s, etl::span<const uint8_t>(d + at, size - at));
                if (n <= 0) break;
                at += static_cast<size_t>(n);
            }
        if (at == size) return true;
        const size_t was = peer->send_buf.size();
        if (was - peer->send_at + (size - at) > MAX_SEND_BACKLOG || !peer->send_buf.resize(was + size - at)) {
            log("%s doesn't take what is sent (%u bytes waiting): connection closed",
                peer->sku.c_str(), static_cast<unsigned>(was - peer->send_at));
            peer->broken = true;
            peer->send_buf.clear();
            peer->send_at = 0;
            return false;
        }
        memcpy(peer->send_buf.data() + was, d + at, size - at);
        return true;
    };
    if (put(header, 4)) put(payload.data(), payload.size());
}

void Node::flush_sends(PeerConnection& peer) {
    while (peer.send_at < peer.send_buf.size()) {
        const int n = tcp_.send(peer.socket, etl::span<const uint8_t>(peer.send_buf.data() + peer.send_at,
                                                                     peer.send_buf.size() - peer.send_at));
        if (n <= 0) return;
        peer.send_at += static_cast<size_t>(n);
    }
    peer.send_buf.clear();
    peer.send_at = 0;
    if (peer.send_buf.capacity() > 65536) peer.send_buf.shrink();
}

// What a node says it understands: the core's features, and its host's
void Node::set_host_features(uint32_t f) { host_features_ = f & HOST_FEATURES; }
uint32_t Node::features() const { return FEATURES_9_3 | host_features_; }

uint32_t Node::peer_features(const char* sku) const {
    for (const auto& p : peers_)
        if (p.sku == sku && p.hello_received && !p.retired) return p.features;
    return 0;
}

void Node::send_hello(PeerConnection& peer) {
    MsgHello hello;
    hello.identity = identity_;
    hello.proto = PROTO_VERSION;
    hello.listen_port = listen_port_;
    hello.versions = world_.version_vector();
    hello.conn_versions = world_.conn_versions();
    hello.scene = scene_cue_;
    hello.phase = phase_cue_;
    hello.halt = halt_cue_;
    hello.max_frame = max_frame();
    hello.mem = memory_state();
    hello.features = features();
    hello.universe = universe_;
    hello.clock = clock_state();
    hello.role = role_;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_hello(buf,
                              ++seq_, identity_.sku.c_str(), hello); });
    if (len > 0) {
        send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    }
}

void Node::send_declare_self(PeerConnection& peer) {
    if (peer.role == NodeRole::Source) return; // it keeps no world view

    MsgDeclare decl;
    decl.about_sku = identity_.sku;
    decl.decl_version = decl_version_;
    decl.identity = identity_;
    decl.scene = scene_status_;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_declare(buf,
                                ++seq_, decl, local_params_); });
    if (len > 0 && fits(peer, len, "DECLARE self")) {
        send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Sent DECLARE self (%zu bytes) to %s", len, peer.sku.c_str());
    }
}

// An address only this machine reaches: not one to pass on
static bool is_loopback(const char* a) {
    return std::strncmp(a, "127.", 4) == 0 || std::strcmp(a, "::1") == 0 ||
           std::strcmp(a, "localhost") == 0;
}

void Node::send_declare_about(PeerConnection& peer, const NodeEntry& entry) {
    if (peer.role == NodeRole::Source) return; // it keeps no world view
    if (entry.is_local) { send_declare_self(peer); return; }   // from our own tree

    MsgDeclare decl;
    decl.about_sku = entry.identity.sku;
    decl.decl_version = entry.decl_version;
    decl.identity = entry.identity;
    decl.scene = entry.scene;
    // Where we reach it: how a node without mDNS finds it
    if (const PeerConnection* at = find_peer_by_sku(entry.identity.sku.c_str())) {
        if (at->socket != INVALID_SOCKET_HANDLE && at->hello_received && at->port &&
            !is_loopback(at->address.c_str())) {
            decl.at_address = at->address;
            decl.at_port = at->port;
        }
    }

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_declare(buf,
                                ++seq_, decl, entry.params); });
    if (len > 0 && fits(peer, len, "a DECLARE")) {
        send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    }
}

// A frame the peer can take: no bigger than the max_frame its HELLO said
// (peers before 8.2 say none, and skip what they can't hold).
bool Node::fits(const PeerConnection& peer, size_t len, const char* what) {
    if (peer.max_frame == 0 || len <= peer.max_frame) return true;
    log("Not sending %s (%zu bytes) to %s: it takes up to %u",
        what, len, peer.sku.c_str(), static_cast<unsigned>(peer.max_frame));
    return false;
}

void Node::send_digest(PeerConnection& peer) {
    MsgDigest digest;
    digest.versions = world_.version_vector();
    digest.conn_versions = world_.conn_versions();
    digest.scene = scene_cue_;
    digest.phase = phase_cue_;
    digest.halt = halt_cue_;
    digest.mem = memory_state();
    digest.clock = clock_state();

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_digest(buf,
                               ++seq_, digest); });
    if (len > 0) {
        send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    }
}

void Node::send_flush(const char* target_sku) {
    MsgFlush flush;
    flush.target_sku = target_sku;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_flush(buf,
                              ++seq_, flush); });
    if (len > 0) {
        auto payload = etl::span<const uint8_t>(encode_buf_.data(), len);
        for (auto& peer : peers_) {
            if (peer.socket != INVALID_SOCKET_HANDLE && peer.hello_received) {
                send_framed(peer.socket, payload);
            }
        }
    }
}

expected<void, Error> Node::send_param_admin(const char* target_sku, const char* payload_json) {
    if (identity_.sku == target_sku) {
        if (param_admin_cb_) {
            param_admin_cb_(target_sku, payload_json, param_admin_ctx_);
        }
        return {};
    }
    auto* peer = find_peer_by_sku(target_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE) {
        log("send_param_admin: peer %s not found or disconnected", target_sku);
        return unexpected<Error>(Error::NotConnected);
    }

    MsgParamAdmin msg;
    msg.target_sku = target_sku;
    msg.payload = payload_json;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_param_admin(buf,
                                     ++seq_, msg); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Forwarded param_admin to %s", target_sku);
    }
    return {};
}

expected<void, Error> Node::send_blob(const char* target_sku, const char* key,
                                      const uint8_t* data, size_t data_len) {
    // Local delivery: write to storage and fire callback directly
    if (identity_.sku == target_sku) {
        storage_.write(key, etl::span<const uint8_t>(data, data_len));
        if (blob_cb_) {
            blob_cb_(key, data, data_len, blob_ctx_);
        }
        return {};
    }
    auto* peer = find_peer_by_sku(target_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE) {
        log("send_blob: peer %s not found or disconnected", target_sku);
        return unexpected<Error>(Error::NotConnected);
    }

    MsgBlob msg;
    msg.target_sku = target_sku;
    msg.key = key;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_blob(buf,
                             ++seq_, msg,
                             etl::span<const uint8_t>(data, data_len)); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Sent BLOB to %s key=%s len=%zu", target_sku, key, data_len);
    }
    return {};
}

expected<void, Error> Node::send_blob_req(const char* target_sku, const char* key) {
    auto* peer = find_peer_by_sku(target_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE) {
        log("send_blob_req: peer %s not found or disconnected", target_sku);
        return unexpected<Error>(Error::NotConnected);
    }

    MsgBlobReq msg;
    msg.target_sku = target_sku;
    msg.key = key;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_blob_req(buf,
                                 ++seq_, msg); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Sent BLOB_REQ to %s key=%s", target_sku, key);
    }
    return {};
}

// --- Internal: timeouts ---

void Node::poll_timeouts() {
    uint64_t now = clock_.millis();

    // Another universe's node not heard of for a while is gone (a backend
    // that says no goodbye: it hears what is there again and again)
    if (!mdns_.reports_lost()) {
        bool changed = false;
        for (size_t i = 0; i < other_universes_.size();) {
            if (now - other_universes_[i].heard_ms > UNIVERSE_SEEN_MS) {
                other_universes_.erase(other_universes_.begin() + static_cast<ptrdiff_t>(i));
                changed = true;
            } else {
                ++i;
            }
        }
        if (changed) universes_changed();
    }

    for (size_t i = 0; i < peers_.size(); ) {
        auto& peer = peers_[i];
        if (peer.hello_received &&
            peer.last_msg_ms > 0 &&
            (now - peer.last_msg_ms) > PEER_TIMEOUT_MS) {
            log("Peer timeout: %s", peer.sku.c_str());
            const bool left = connection_lost(peer);
            peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
            if (left) topology_changed();
            continue;
        }
        // Up but silent: the other end never said HELLO (a board out of
        // sockets accepts at the chip and never reads). Without this the
        // connection stayed forever, and no new dial was made to that node.
        if (!peer.hello_received && peer.opened_ms > 0 &&
            (now - peer.opened_ms) > HELLO_TIMEOUT_MS) {
            log("No HELLO from %s in %u s: connection closed",
                peer.sku.empty() ? "an inbound peer" : peer.sku.c_str(),
                static_cast<unsigned>(HELLO_TIMEOUT_MS / 1000));
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
            peers_.erase(peers_.begin() + static_cast<ptrdiff_t>(i));
            continue;
        }
        ++i;
    }
}

// --- Internal: periodic digest ---

void Node::poll_digest() {
    uint64_t now = clock_.millis();
    // Slower in presentation: the mesh is settled, the network is the show's
    const uint64_t interval = phase() == Phase::Presentation ? 3 * DIGEST_INTERVAL_MS
                                                             : DIGEST_INTERVAL_MS;
    if ((now - last_digest_ms_) < interval) return;
    last_digest_ms_ = now;

    // Gossip is between full nodes: a source has nothing to tell, and
    // nothing to learn
    if (role_ == NodeRole::Source) return;
    for (auto& peer : peers_) {
        if (peer.hello_received && peer.socket != INVALID_SOCKET_HANDLE &&
            peer.role != NodeRole::Source) {
            send_digest(peer);
        }
    }
}

// --- Connections on a transport that has few ---

size_t Node::open_peers() const {
    size_t n = 0;
    for (const auto& p : peers_) n += (p.socket != INVALID_SOCKET_HANDLE && !p.retired) ? 1 : 0;
    return n;
}

// 2: values flow between us (we listen to it, or it to us); 1: a visualizer
// watches our values through it; 0: gossip only.
int Node::usefulness(const PeerConnection& peer) const {
    if (peer.sku.empty()) return 0;
    if (listens_to(peer.sku.c_str())) return 2;
    int best = 0;
    for (const auto& t : stream_targets_) {
        if (t.dest_sku != peer.sku) continue;
        if (!t.monitor) return 2;
        best = 1;
    }
    return best;
}

void Node::poll_connection_limit() {
    const size_t limit = tcp_.connection_limit();
    if (limit == 0) return;
    const uint64_t now = clock_.millis();
    if (now - last_limit_ms_ < 1000) return;
    last_limit_ms_ = now;
    // One spare, so a node that needs us can still connect: the chip refuses
    // a caller outright when every socket is taken, and we never see it
    if (open_peers() < limit) { limit_logged_ = false; return; }
    // Closed before for room, and back while we are still at the limit:
    // no new grace (a full node redials at every mDNS sighting)
    for (auto& p : peers_) {
        if (p.socket == INVALID_SOCKET_HANDLE || p.retired || !p.hello_received) continue;
        if (usefulness(p) == 2) continue;
        for (const auto& c : closed_for_room_) {
            if (c.sku == p.sku && now - c.at_ms < 5 * 60 * 1000) {
                p.hello_ms = 0;          // its grace is spent
                break;
            }
        }
    }
    PeerConnection* least = nullptr;
    int least_use = 3;
    for (auto& p : peers_) {
        if (p.socket == INVALID_SOCKET_HANDLE || p.retired || !p.hello_received) continue;
        if (now - p.hello_ms < connection_grace_ms_) continue;      // still saying what it wants
        const int u = usefulness(p);
        if (u < least_use || (u == least_use && least && p.hello_ms < least->hello_ms)) {
            least = &p;
            least_use = u;
        }
    }
    if (least && least_use < 2) {
        char why[96];
        snprintf(why, sizeof(why), "connection limit (%u), %s, to keep one spare",
                 static_cast<unsigned>(limit),
                 least_use == 1 ? "a visualizer watching" : "no values between us");
        detach(*least, why);
        limit_logged_ = false;
        ClosedPeer* c = nullptr;
        for (auto& x : closed_for_room_) if (x.sku == least->sku) c = &x;
        if (!c) c = closed_for_room_.emplace_back();
        if (c) { c->sku = least->sku; c->at_ms = now; }
    } else if (!limit_logged_) {
        log("Connection limit (%u) reached: every connection carries values, none closed",
            static_cast<unsigned>(limit));
        limit_logged_ = true;
    }
}

void Node::detach(PeerConnection& peer, const char* why) {
    log("Closing the connection to %s: %s", peer.sku.c_str(), why);
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_detach(buf, ++seq_); });
    if (len > 0 && peer.socket != INVALID_SOCKET_HANDLE)
        send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    disconnect_peer(peer);              // closes the socket, drops its stream targets
    peer.retired = true;                // removed at the next poll; the node stays known
}

// --- Presentation: only what carries values ---

// The full node a satellite keeps a connection to in presentation, for the
// cues (phase, scenes) and to stay visible: the one connected longest.
const Node::PeerConnection* Node::anchor() const {
    const PeerConnection* best = nullptr;
    for (const auto& p : peers_) {
        if (p.socket == INVALID_SOCKET_HANDLE || p.retired || !p.hello_received) continue;
        if (p.role != NodeRole::Full) continue;
        if (!best || p.hello_ms < best->hello_ms) best = &p;
    }
    return best;
}

bool Node::listened_by(const char* sku) const {
    const NodeEntry* e = world_.find_node(sku);
    if (!e) return false;
    for (const auto& c : e->connections)
        if (c.source_sku == identity_.sku) return true;
    return false;
}

// What a peer may be told: every list we hold, or for a satellite, ours only
WorldView::VersionVector Node::relayable_conn_versions() const {
    auto cv = world_.conn_versions();
    if (role_ == NodeRole::Satellite) {
        WorldView::VersionVector own;
        auto it = cv.find(identity_.sku);
        if (it != cv.end()) own[it->first] = it->second;
        return own;
    }
    return cv;
}

void Node::send_missing_connections(PeerConnection& peer, const WorldView::VersionVector& theirs) {
    if (peer.role == NodeRole::Source) return;           // it keeps no world view
    for (const auto& kv : relayable_conn_versions()) {
        auto it = theirs.find(kv.first);
        if (it != theirs.end() && it->second >= kv.second) continue;
        if (kv.first == peer.sku) continue;              // its own: it knows better
        if (const NodeEntry* e = world_.find_node(kv.first.c_str())) send_connections(peer, *e);
    }
    // A version of ours it holds that we don't (we lost our storage): ours
    // goes past it, so the new list wins
    auto mine = theirs.find(identity_.sku);
    if (mine != theirs.end() && mine->second > conn_version_) {
        conn_version_ = mine->second;
        connections_changed();
    }
}

// Should we call this node while in presentation?
// `unknown`: the role its mDNS record says, for a node the world doesn't know
bool Node::wanted_in_presentation(const char* sku, NodeRole unknown) const {
    if (listens_to(sku) || listened_by(sku)) return true;   // values flow between us
    const NodeEntry* e = world_.find_node(sku);
    const NodeRole other = e ? e->role : unknown;
    if (role_ == NodeRole::Satellite)                       // one full node, for the cues
        return other == NodeRole::Full && !anchor();
    return other != NodeRole::Satellite;                    // full nodes keep their mesh
}

// A satellite decides: it keeps its anchor and what carries values, and
// closes the rest. (A full node can't know which full node a satellite
// keeps as its anchor; it just doesn't call satellites it has no business
// with.)
void Node::poll_presentation_links() {
    if (phase() != Phase::Presentation || role_ != NodeRole::Satellite) return;
    const uint64_t now = clock_.millis();
    if (now - last_presentation_ms_ < 1000) return;
    last_presentation_ms_ = now;
    const PeerConnection* keep = anchor();
    for (auto& p : peers_) {
        if (p.socket == INVALID_SOCKET_HANDLE || p.retired || !p.hello_received) continue;
        if (&p == keep || now - p.hello_ms < connection_grace_ms_) continue;
        if (usefulness(p) == 2 || listened_by(p.sku.c_str())) continue;   // values flow between us
        detach(p, "presentation, no values between us");
    }
}

// --- Nodes on another protocol ---

void Node::note_incompatible(const char* sku, const char* label, uint8_t core_major, uint8_t proto,
                             const char* address, uint16_t port, const char* core_ver,
                             const char* product) {
    IncompatibleNode* n = nullptr;
    for (auto& x : incompatible_) if (x.sku == sku) n = &x;
    const bool fresh = !n;
    if (!n) n = incompatible_.emplace_back();
    if (!n) return;
    n->sku = sku;
    if (label && *label) n->label = label;
    if (core_major) n->core_major = core_major;
    if (proto) n->proto = proto;
    if (address && *address) { n->address = address; if (port) n->port = port; }
    if (core_ver && *core_ver) n->core_ver = core_ver;
    if (product && *product) n->product = product;
    n->last_ms = clock_.millis();
    if (fresh) {
        if (proto)
            log("%s speaks protocol %u, this node %u: refused", sku,
                static_cast<unsigned>(proto), static_cast<unsigned>(PROTO_VERSION));
        else
            log("%s runs core %u.x, this node %u.x: not called", sku,
                static_cast<unsigned>(core_major), static_cast<unsigned>(DATAFLOU_VERSION_MAJOR));
        topology_changed();
    }
}

// --- Forgetting ---

void Node::forget(const char* sku, const char* why) {
    etl::string<36> s = sku;                 // sku may point into the entry
    if (!world_.remove_node(s.c_str())) return;
    ++world_gen_;
    monitors_stale_ = true;
    restart_stream_names(s.c_str());
    log("Forgot %s (%s)", s.c_str(), why);
}

bool Node::forget_oldest_offline(const char* keep) {
    // Two passes: the nodes we don't listen to go first
    for (int pass = 0; pass < 2; ++pass) {
        const NodeEntry* oldest = nullptr;
        uint64_t oldest_ms = 0;
        for (const auto& e : world_.nodes()) {
            if (e.is_local || e.online || e.identity.sku == keep) continue;
            if (pass == 0 && listens_to(e.identity.sku.c_str())) continue;
            const uint64_t since = e.offline_since_ms ? e.offline_since_ms : e.last_seen_ms;
            if (!oldest || since < oldest_ms) { oldest = &e; oldest_ms = since; }
        }
        if (oldest) {
            forget(oldest->identity.sku.c_str(), "offline, to make room");
            topology_changed();
            return true;
        }
    }
    return false;
}

// A satellite forgets an offline node after forget_after_ms_: nothing comes
// from it meanwhile, and its HELLO brings a fresh declaration when it returns
// (connections to it live in our own params, not in its entry).
void Node::poll_forget() {
    if (role_ != NodeRole::Satellite) return;
    const uint64_t now = clock_.millis();
    if (now - last_forget_ms_ < 1000) return;
    last_forget_ms_ = now;
    Vector<etl::string<36>> gone;
    for (const auto& e : world_.nodes()) {
        if (e.is_local || e.online) continue;
        const uint64_t since = e.offline_since_ms ? e.offline_since_ms : e.first_seen_ms;
        if (now - since >= forget_after_ms_) gone.push_back(e.identity.sku);
    }
    for (const auto& sku : gone) forget(sku.c_str(), "offline");
    if (!gone.empty()) topology_changed();
}

size_t Node::forget_offline(bool mesh_wide) {
    Vector<etl::string<36>> gone;
    for (const auto& e : world_.nodes())
        if (!e.is_local && !e.online) gone.push_back(e.identity.sku);
    for (const auto& sku : gone) {
        if (mesh_wide) flush_node(sku.c_str());
        else forget(sku.c_str(), "asked");
    }
    if (!gone.empty()) topology_changed();
    return gone.size();
}

// Checked a poll later, so a scene that swaps a source (removed, then the
// new one added) does not ground in between.

// --- Seeds: nodes dialled by address ---

static constexpr uint64_t SEED_RETRY_MS   = 5000;
static constexpr uint64_t SEED_REFUSED_MS = 60000;   // another universe or protocol

void Node::add_seed(const char* host, uint16_t port) {
    for (const auto& s : seeds_)
        if (s.host == host && s.port == port) return;
    Seed s;
    s.host = host;
    s.port = port;
    if (seeds_.push_back(s)) log("Seed: %s:%u", host, static_cast<unsigned>(port));
}

void Node::poll_seeds() {
    if (seeds_.empty()) return;
    const uint64_t now = clock_.millis();
    for (size_t i = 0; i < seeds_.size(); ++i) {
        Seed& s = seeds_[i];
        if (now - s.last_try_ms < (s.refused ? SEED_REFUSED_MS : SEED_RETRY_MS)) continue;
        // Linked to it already: by the connection we dialled, or another
        // (mDNS found it too, or it called us)
        bool linked = false;
        for (const auto& p : peers_) {
            if (p.socket == INVALID_SOCKET_HANDLE || p.retired) continue;
            if (p.seed == static_cast<int8_t>(i) ||
                (!s.sku.empty() && p.sku == s.sku) ||
                (p.address == s.host && p.port == s.port)) { linked = true; break; }
        }
        if (linked) continue;
        s.last_try_ms = now;
        if (peers_.full()) continue;
        SocketHandle sock = tcp_.connect(s.host.c_str(), s.port);
        if (sock == INVALID_SOCKET_HANDLE) continue;
        PeerConnection pc;
        pc.socket = sock;
        pc.address = s.host;
        pc.port = s.port;
        pc.connect_started_ms = now;
        pc.seed = static_cast<int8_t>(i);
        if (!peers_.push_back(pc)) tcp_.close(sock);
    }
}

// A node a peer reaches at this address (its declaration said so): as if
// mDNS had found it, for networks where mDNS doesn't reach
void Node::hint_peer(const char* sku, const char* address, uint16_t port) {
    if (find_peer_by_sku(sku)) return;
    MdnsEvent ev;
    ev.type = MdnsEvent::PeerFound;
    ev.sku = sku;
    ev.address = address;
    ev.port = port;
    ev.universe = universe_;
    if (const NodeEntry* e = world_.find_node(sku)) ev.role = e->role;
    handle_peer_found(ev);
}

} // namespace dataflou
