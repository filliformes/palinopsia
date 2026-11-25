// node_messages.cpp — what a peer's messages do (handle_message).

#include "node_internal.h"

namespace dataflou {


// --- Internal: message handling ---

// A key a peer may read or write in our storage: a relative path of plain
// names ("atelier/source.lua"). Nothing that climbs out of the storage
// folder, and none of the files the node keeps there for itself.
static bool peer_blob_key_ok(const char* key) {
    const size_t len = std::strlen(key);
    if (len == 0 || key[0] == '/') return false;
    size_t start = 0;
    for (size_t i = 0; i <= len; ++i) {
        const unsigned char c = static_cast<unsigned char>(key[i]);
        if (i < len && (c < 0x20 || c == 0x7F || c == '\\' || c == ':')) return false;
        if (i == len || c == '/') {
            const size_t n = i - start;
            if (n == 0) return false;                                       // "a//b", "a/"
            if (key[start] == '.') return false;                            // ".", "..", hidden
            start = i + 1;
        }
    }
    if (std::strchr(key, '/')) return true;
    return std::strcmp(key, "world") != 0 && std::strcmp(key, "subscriptions") != 0 &&
           std::strcmp(key, "scenes") != 0 && std::strncmp(key, "scene_", 6) != 0 &&
           std::strcmp(key, "decl") != 0 && std::strcmp(key, "phase") != 0 &&
           std::strcmp(key, "halt") != 0 && std::strcmp(key, "connections") != 0;
}

void Node::handle_message(PeerConnection& peer, etl::span<const uint8_t> data) {
    DecodedMsg msg;
    if (!decode_message(data, msg)) {
        // A source keeps no world view: other nodes' DECLAREs (from peers
        // older than 8.2, which don't know our role) are not even decoded.
        if (role_ == NodeRole::Source) return;

        // Try as DECLARE: its header first, to decide; its params, if
        // taken, go straight into the world entry (no copy in between, and
        // nothing shared between nodes of one process).
        uint32_t seq = 0;
        MsgDeclare decl;
        if (decode_declare_header(data, seq, decl)) {
            // Nothing is taken from a peer that has not said who it is; nobody
            // declares us to ourselves; and a declaration is about the node
            // its identity names.
            if (!peer.hello_received) {
                log("DECLARE before HELLO, ignored");
                return;
            }
            const etl::string<36>& from_sku = peer.sku;   // who its HELLO said
            if (decl.about_sku.empty() || decl.about_sku == identity_.sku ||
                decl.identity.sku != decl.about_sku) {
                log("DECLARE about %s ignored", decl.about_sku.c_str());
                return;
            }
            // Where the sender reaches it: a node mDNS didn't show us
            if (!decl.at_address.empty() && decl.about_sku != from_sku)
                hint_peer(decl.about_sku.c_str(), decl.at_address.c_str(), decl.at_port);
            // A satellite learns who is there from themselves (mDNS, HELLO):
            // a stranger relayed by a third node is not taken, or a node it
            // forgot would come back with the next gossip
            if (role_ == NodeRole::Satellite && decl.about_sku != from_sku &&
                !world_.find_node(decl.about_sku.c_str()) && !listens_to(decl.about_sku.c_str())) {
                return;
            }
            // Update world view; short of memory, room is made by forgetting
            // the offline nodes heard from longest ago
            auto* entry = world_.upsert_node(decl.about_sku.c_str());
            while (!entry && forget_oldest_offline(decl.about_sku.c_str()))
                entry = world_.upsert_node(decl.about_sku.c_str());
            if (!entry) {
                log("DECLARE about %s refused: out of memory (%u bytes in use)",
                    decl.about_sku.c_str(), static_cast<unsigned>(Memory::used()));
                return;
            }
            ++world_gen_;   // the entry may be new, its tree is about to be replaced
            if (decl.decl_version > entry->decl_version) {
                entry->params.clear();
                entry->identity = decl.identity;
                entry->decl_version = decl.decl_version;
                entry->scene = decl.scene;
                // A satellite keeps who is there, not what they hold: the
                // params of a node it doesn't listen to are not even decoded
                if (role_ != NodeRole::Satellite || listens_to(decl.about_sku.c_str())) {
                    size_t dropped = 0;
                    decode_declare_params(data, entry->params, &dropped);
                    while (dropped > 0 && forget_oldest_offline(decl.about_sku.c_str())) {
                        entry->params.clear();
                        dropped = 0;
                        decode_declare_params(data, entry->params, &dropped);
                    }
                    if (dropped > 0)
                        log("DECLARE about %s: %u params left out, out of memory (%u bytes in use)",
                            decl.about_sku.c_str(), static_cast<unsigned>(dropped),
                            static_cast<unsigned>(Memory::used()));
                }
                // Only mark online if the sender IS this node (direct connection).
                // Third-party declares don't prove liveness.
                if (decl.about_sku == from_sku) {
                    entry->online = true;
                }
                entry->last_seen_ms = clock_.millis();
                if (entry->first_seen_ms == 0) {
                    entry->first_seen_ms = entry->last_seen_ms;
                }
                log("Received DECLARE about %s (v%u) from %s",
                    decl.about_sku.c_str(), decl.decl_version, from_sku.c_str());
                // Its params, as its connections feed them; and ours that
                // take from it make their links again
                expand_connections(*entry);
                if (listens_to(decl.about_sku.c_str())) relink();

                topology_changed();
            }
            // It declared itself: what we asked of it that went unanswered
            // (a param it didn't have yet), asked again
            if (decl.about_sku == from_sku) ask_waiting_monitors(from_sku.c_str());
        }
        return;
    }

    // Nothing is taken from a peer that has not said who it is.
    if (msg.type != MsgType::Hello && !peer.hello_received) {
        log("Message before HELLO, ignored");
        return;
    }
    // After it, a peer is who its HELLO said: messages don't say "from" (9.1)
    if (msg.type != MsgType::Hello) msg.from_sku = peer.sku;

    switch (msg.type) {
    case MsgType::Hello: {
        // A peer is someone else, and says who: not nobody, not us.
        if (msg.from_sku.empty() || msg.from_sku == identity_.sku) {
            log("HELLO from %s ignored", msg.from_sku.empty() ? "nobody" : "our own sku");
            return;
        }
        // Another protocol: nothing it sends can be read right, nor what we
        // send by it. Refused, and remembered for the visualizer.
        if (msg.hello.proto != PROTO_VERSION) {
            char addr[46] = {};
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.remote_addr(peer.socket, addr, sizeof(addr));
            note_incompatible(msg.from_sku.c_str(), msg.hello.identity.label.c_str(), 0,
                              msg.hello.proto, addr, msg.hello.listen_port, nullptr,
                              msg.hello.identity.product.c_str());
            if (peer.seed >= 0 && static_cast<size_t>(peer.seed) < seeds_.size())
                seeds_[peer.seed].refused = true;
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
            peer.socket = INVALID_SOCKET_HANDLE;
            peer.retired = true;
            return;
        }
        // Another universe (a seed dialled by address can be): not ours to talk to
        if (!msg.hello.universe.empty() && msg.hello.universe != universe_) {
            log("HELLO from %s refused: universe '%s', not ours", msg.from_sku.c_str(),
                msg.hello.universe.c_str());
            if (peer.seed >= 0 && static_cast<size_t>(peer.seed) < seeds_.size())
                seeds_[peer.seed].refused = true;
            if (peer.socket != INVALID_SOCKET_HANDLE) tcp_.close(peer.socket);
            peer.socket = INVALID_SOCKET_HANDLE;
            peer.retired = true;
            return;
        }
        if (peer.seed >= 0 && static_cast<size_t>(peer.seed) < seeds_.size()) {
            seeds_[peer.seed].sku = msg.from_sku;
            seeds_[peer.seed].refused = false;
        }
        // A node that comes back on a new connection while the old one is not
        // yet found dead (a board after a power cycle): the old one goes now,
        // quietly, so lookups by sku find the live one and the old one's
        // death later does not mark the node offline.
        for (auto& old : peers_) {
            if (&old != &peer && !old.retired && old.sku == msg.from_sku) {
                if (old.socket != INVALID_SOCKET_HANDLE) tcp_.close(old.socket);
                old.socket = INVALID_SOCKET_HANDLE;
                old.retired = true;
                log("%s came back on a new connection: the old one is closed", msg.from_sku.c_str());
            }
        }
        peer.sku = msg.from_sku;
        peer.hello_received = true;
        peer.hello_ms = clock_.millis();
        restart_stream_names(msg.from_sku.c_str());   // PALINOPSIA FIX 1 : its packet counts start over
        peer.max_frame = msg.hello.max_frame;
        peer.role = msg.hello.role;
        peer.features = msg.hello.features;
        peer.clock = msg.hello.clock;

        // Populate address from TCP socket + HELLO listen_port
        {
            char addr_buf[46] = {};
            if (tcp_.remote_addr(peer.socket, addr_buf, sizeof(addr_buf))) {
                peer.address.assign(addr_buf);
            }
            if (msg.hello.listen_port != 0) {
                peer.port = msg.hello.listen_port;
            }
        }

        // Fall back to mDNS cache if remote_addr failed (shouldn't happen)
        if (peer.address.empty()) {
            for (size_t pi = 0; pi < pending_peers_.size(); ++pi) {
                if (pending_peers_[pi].sku == msg.from_sku) {
                    peer.address = pending_peers_[pi].address;
                    if (peer.port == 0) {
                        peer.port = pending_peers_[pi].port;
                    }
                    pending_peers_.erase(pending_peers_.begin() + static_cast<ptrdiff_t>(pi));
                    break;
                }
            }
        }

        // Mark in world view (a source keeps none: it answers and streams)
        NodeEntry* entry = nullptr;
        if (role_ != NodeRole::Source) {
            world_.mark_online(msg.from_sku.c_str(), clock_.millis());
            settle_fed_by(msg.from_sku.c_str(), EndOrigin::None);   // its destinations here are fed again
            entry = world_.upsert_node(msg.from_sku.c_str());
        }
        if (entry) {
            // Reset cached decl_version on (re)connection so we always
            // accept the peer's fresh DECLARE after a reboot.
            if (!entry->is_local) {
                entry->decl_version = 0;
            }
            entry->identity = msg.hello.identity;
            entry->identity.sku = msg.from_sku;   // the entry's key, whatever the identity says
            entry->role = msg.hello.role;
            entry->max_frame = msg.hello.max_frame;
            entry->mem = msg.hello.mem;
            entry->online = true;
            entry->last_seen_ms = clock_.millis();
            settle_fed_by(msg.from_sku.c_str(), EndOrigin::None);   // PALINOPSIA FIX 2 : met for the first time, it is in the world only now
            if (entry->first_seen_ms == 0) {
                entry->first_seen_ms = entry->last_seen_ms;
            }
        }

        log("HELLO from %s (%s)%s", msg.hello.identity.label.c_str(),
            msg.from_sku.c_str(), peer.role == NodeRole::Source ? ", a source" : "");

        // If we haven't sent our HELLO yet (inbound connection), send it
        if (!peer.hello_sent) {
            send_hello(peer);
            peer.hello_sent = true;
        }

        // Compare version vectors and send missing DECLAREs (not to a
        // source: it keeps no world view; and a satellite tells only of itself)
        auto our_vv = relayable_versions();
        if (peer.role == NodeRole::Source) our_vv.clear();
        for (const auto& kv : our_vv) {
            const auto& sku = kv.first;
            uint32_t our_ver = kv.second;
            // Check if peer has this node at a lower version
            auto it = msg.hello.versions.find(sku);
            if (it == msg.hello.versions.end() || it->second < our_ver) {
                // Peer is missing or outdated — send DECLARE
                auto* node_entry = world_.find_node(sku.c_str());
                if (node_entry) {
                    send_declare_about(peer, *node_entry);
                }
            }
        }

        // Also declare ourselves
        send_declare_self(peer);
        // And the connection lists it doesn't have (ours among them)
        send_missing_connections(peer, msg.hello.conn_versions);

        // Re-send StreamRequests for any subscriptions sourced from this peer,
        // and for the monitors of its params. Needed on reconnection so the
        // source recreates StreamTargets.
        resend_stream_requests_for_peer(peer.sku.c_str());

        if (peer_joined_cb_) {
            peer_joined_cb_(entry ? entry->identity : msg.hello.identity, peer_joined_ctx_);
        }
        topology_changed();

        // A recall made while we were away: apply it now (a source has no
        // connections to recall)
        if (role_ != NodeRole::Source) merge_scene_cue(msg.hello.scene);
        handle_phase(msg.hello.phase, &peer);
        handle_halt(msg.hello.halt, &peer);
        break;
    }

    case MsgType::Ack:
        // ACK received — nothing to do for now
        break;

    case MsgType::Identify:
        log("IDENTIFY from %s", msg.from_sku.c_str());
        if (identify_cb_) identify_cb_(msg.from_sku.c_str(), identify_ctx_);
        break;

    case MsgType::Leave: {
        log("LEAVE from %s", msg.from_sku.c_str());
        auto* entry = world_.find_node(msg.from_sku.c_str());
        mark_offline(msg.from_sku.c_str());
        if (peer_left_cb_ && entry) {
            peer_left_cb_(entry->identity, peer_left_ctx_);
        }
        topology_changed();
        break;
    }

    case MsgType::Digest: {
        peer.clock = msg.digest.clock;
        if (msg.digest.mem.said())
            if (auto* e = world_.find_node(msg.from_sku.c_str())) e->mem = msg.digest.mem;
        // Compare version vectors (a source's world is itself only, and a
        // satellite tells only of itself)
        auto our_vv = relayable_versions();
        if (peer.role == NodeRole::Source) our_vv.clear();
        for (const auto& kv : our_vv) {
            auto it = msg.digest.versions.find(kv.first);
            if (it == msg.digest.versions.end() || it->second < kv.second) {
                auto* entry = world_.find_node(kv.first.c_str());
                if (entry) {
                    send_declare_about(peer, *entry);
                }
            }
        }
        // A declaration of ours it holds that we don't (we lost our storage,
        // or run on another machine now): ours goes past it, or nobody would
        // take our declarations until our count caught up
        if (auto mine = msg.digest.versions.find(identity_.sku);
            mine != msg.digest.versions.end() && mine->second > decl_version_) {
            log("Declaration %u of ours known to %s: going on from there",
                static_cast<unsigned>(mine->second), peer.sku.c_str());
            decl_version_ = mine->second;
            redeclare();
        }
        send_missing_connections(peer, msg.digest.conn_versions);
        peer.last_msg_ms = clock_.millis();
        if (role_ != NodeRole::Source) merge_scene_cue(msg.digest.scene);
        handle_phase(msg.digest.phase, &peer);
        handle_halt(msg.digest.halt, &peer);
        break;
    }

    case MsgType::Phase:
        handle_phase(msg.phase.cue, &peer);
        break;

    case MsgType::Detach:
        peer.detached = true;
        break;

    case MsgType::Scene:
        // Scenes are connections kept by destinations: a source has none
        if (role_ != NodeRole::Source)
            handle_scene(msg.scene.op, msg.scene.slot, msg.scene.stamp, &peer);
        break;

    case MsgType::Flush: {
        log("FLUSH for %s from %s", msg.flush.target_sku.c_str(),
            msg.from_sku.c_str());
        // Our own entry is not a peer's to remove: without it the node no
        // longer mirrors its params into the world.
        if (msg.flush.target_sku == identity_.sku) break;
        world_.remove_node(msg.flush.target_sku.c_str());
        ++world_gen_;
        topology_changed();
        break;
    }

    case MsgType::SubRequest: {
        const auto& sr = msg.sub_request;
        log("SubRequest received: sub=%s dest=%s/%s src=%s/%s (my sku=%s)",
            sr.subscribe ? "true" : "false",
            sr.dest_sku.c_str(), sr.dest_path.c_str(),
            sr.source_sku.c_str(), sr.source_path.c_str(),
            identity_.sku.c_str());
        // Only act if this request is addressed to us
        if (sr.dest_sku == identity_.sku) {
            if (sr.subscribe) {
                if (subscribe(sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str(), sr.id, sr.pick)) {
                    log("SubRequest: subscribed %s <- %s/%s",
                        sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str());
                } else {
                    log("SubRequest: subscribe FAILED %s <- %s/%s",
                        sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str());
                }
            } else {
                if ((!sr.id.empty() && unsubscribe_id(sr.id, EndOrigin::Outside)) ||
                    unsubscribe(sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str(),
                                EndOrigin::Outside)) {
                    log("SubRequest: unsubscribed %s <- %s/%s",
                        sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str());
                } else {
                    log("SubRequest: unsubscribe FAILED %s <- %s/%s",
                        sr.dest_path.c_str(), sr.source_sku.c_str(), sr.source_path.c_str());
                }
            }
        } else {
            log("SubRequest: ignored (dest_sku mismatch)");
        }
        break;
    }

    case MsgType::SetValue: {
        const auto& sv = msg.set_value;
        if (sv.target_sku == identity_.sku) {
            // A param of ours, in its own type: a value of another type is
            // cast as a connection would, or refused
            const ParamNode* target = local_params_.resolve(sv.path.c_str());
            ParamValue v;
            // One element of an array ("lights/3", 9.3): a value of the element's type
            size_t element = 0;
            ParamMetaCore element_shape;
            const ParamMetaCore* shape = target ? &target->meta : nullptr;
            if (!target) {
                target = resolve_element(local_params_, sv.path.c_str(), element);
                if (target) shape = &(element_shape = element_meta(target->meta));
            }
            if (!target || target->meta.kind != ParamKind::Param) {
                log("SetValue: no param %s", sv.path.c_str());
            } else if (target->meta.access == Access::Read) {
                // Declared read: the mesh observes it, only this node sets it
                log("SetValue: %s refused, it is read-only (from %s)", sv.path.c_str(), peer.sku.c_str());
            } else if (sv.unread) {
                log("SetValue: %s refused, an array this node does not read", sv.path.c_str());
            } else if (!cast_to(sv.value, *shape, v, &target->value)) {
                log("SetValue: %s refused, a %s does not take a %s", sv.path.c_str(),
                    to_string(target->meta.type), to_string(sv.value.tag));
            } else {
                set_value(sv.path.c_str(), v);
                log("SetValue: %s = (remote set)", sv.path.c_str());
            }
        }
        break;
    }

    case MsgType::ParamAdmin: {
        const auto& pa = msg.param_admin;
        if (pa.target_sku == identity_.sku) {
            if (param_admin_cb_) {
                param_admin_cb_(pa.target_sku.c_str(), pa.payload.c_str(), param_admin_ctx_);
            }
            log("ParamAdmin received for %s", pa.target_sku.c_str());
        }
        break;
    }

    case MsgType::Blob: {
        // Decode full blob (header was decoded, need data payload separately)
        MsgBlob blob_msg;
        uint32_t blob_seq = 0;
        etl::string<36> blob_from;
        // At most the frame it came in
        Vector<uint8_t> blob_buf;
        if (!blob_buf.resize(data.size())) {
            log("BLOB dropped: out of memory (%zu bytes)", data.size());
            break;
        }
        uint8_t* blob_data = blob_buf.data();
        size_t blob_data_len = 0;
        if (decode_blob(data, blob_seq, blob_msg,
                        etl::span<uint8_t>(blob_data, blob_buf.size()), blob_data_len)) {
            blob_from = peer.sku;
            if (blob_msg.target_sku == identity_.sku && !peer_blob_key_ok(blob_msg.key.c_str())) {
                log("BLOB refused: key %s", blob_msg.key.c_str());
            } else if (blob_msg.target_sku == identity_.sku) {
                // Persist to storage
                storage_.write(blob_msg.key.c_str(), etl::span<const uint8_t>(blob_data, blob_data_len));
                log("BLOB received: key=%s len=%zu from %s",
                    blob_msg.key.c_str(), blob_data_len, blob_from.c_str());
                // Notify application layer (e.g. Atelier facade for hot-reload)
                if (blob_cb_) {
                    blob_cb_(blob_msg.key.c_str(), blob_data, blob_data_len, blob_ctx_);
                }
            }
        }
        break;
    }

    case MsgType::BlobReq: {
        // A remote node is requesting a blob from our storage (or provider)
        if (msg.blob_req.target_sku == identity_.sku && !peer_blob_key_ok(msg.blob_req.key.c_str())) {
            log("BLOB_REQ refused: key %s", msg.blob_req.key.c_str());
        } else if (msg.blob_req.target_sku == identity_.sku) {
            const char* key = msg.blob_req.key.c_str();
            // A blob goes in one frame: no more than we can encode
            Vector<uint8_t> read_vec;
            if (!read_vec.resize(MAX_MSG_BUF)) {
                log("BLOB_REQ failed: out of memory");
                break;
            }
            uint8_t* read_buf = read_vec.data();
            size_t read_len = 0;
            bool found = storage_.read(key, etl::span<uint8_t>(read_buf, read_vec.size()), read_len);
            if (!found && blob_provider_cb_) {
                found = blob_provider_cb_(key, read_buf, read_vec.size(), read_len, blob_provider_ctx_);
            }
            if (found) {
                send_blob(msg.from_sku.c_str(), key, read_buf, read_len);
                log("BLOB_REQ served: key=%s len=%zu to %s",
                    key, read_len, msg.from_sku.c_str());
            } else {
                log("BLOB_REQ failed: key=%s not found", key);
            }
        }
        break;
    }

    case MsgType::StreamRequest: {
        const auto& sr = msg.stream_request;
        // An empty dest_path is a visualizer monitor: best effort, lowest
        // priority, re-requested every keepalive, so it is not logged.
        const bool monitor = sr.dest_path.empty();
        if (!monitor) {
            log("StreamRequest from %s: source=%s dest=%s/%s port=%u rate=%.1f",
                msg.from_sku.c_str(), sr.source_path.c_str(),
                sr.dest_sku.c_str(), sr.dest_path.c_str(),
                sr.dest_udp_port, sr.rate_hz);
        }

        ParamNode* local_node = local_params_.resolve(sr.source_path.c_str());
        // One element of an array ("harmonics/3", 9.3): the array, sent element alone
        size_t element_index = 0;
        int32_t element = -1;
        if (!local_node) {
            local_node = resolve_element(local_params_, sr.source_path.c_str(), element_index);
            if (local_node) element = static_cast<int32_t>(element_index);
        }
        if (!local_node || local_node->meta.kind != ParamKind::Param) {
            if (!monitor) log("StreamRequest: source param '%s' not found", sr.source_path.c_str());
            break;
        }
        if (!readable(local_node->meta.access)) {
            if (!monitor) log("StreamRequest refused: %s is write-only", sr.source_path.c_str());
            break;
        }

        // Check for existing StreamTarget (update on reconnect / keepalive)
        bool found = false;
        uint64_t now_ms = clock_.millis();
        for (auto& t : stream_targets_) {
            if (t.dest_sku == sr.dest_sku &&
                t.local_path == sr.source_path &&
                t.dest_path == sr.dest_path) {
                t.dest_address = peer.address;
                t.dest_udp_port = sr.dest_udp_port;
                t.rate_hz = (sr.rate_hz > 0.0f && local_node->meta.rate > 0.0f)
                    ? std::min(sr.rate_hz, local_node->meta.rate)
                    : std::max(sr.rate_hz, local_node->meta.rate);
                t.local_node = local_node;
                t.element = element;
                t.last_request_ms = now_ms;
                if (sr.stream_id && t.id != sr.stream_id) { t.id = sr.stream_id; t.named_left = 3; }
                t.conn = sr.conn;
                found = true;
                break;
            }
        }
        if (!found) {
            if (monitor) {
                if (stream_targets_.full()) break;  // best effort: never at a connection's cost
            } else if (stream_targets_.full()) {
                // Real subscriptions take priority over visualizer monitors
                for (size_t i = 0; i < stream_targets_.size(); ++i) {
                    if (stream_targets_[i].monitor) {
                        stream_targets_.erase(stream_targets_.begin() + static_cast<ptrdiff_t>(i));
                        break;
                    }
                }
            }
        }
        if (!found && stream_targets_.full() && !monitor) {
            log("StreamRequest refused: %s -> %s/%s, out of memory (%u stream targets, %u bytes in use)",
                sr.source_path.c_str(), sr.dest_sku.c_str(), sr.dest_path.c_str(),
                static_cast<unsigned>(stream_targets_.size()), static_cast<unsigned>(Memory::used()));
        }
        if (!found && !stream_targets_.full()) {
            StreamTarget st;
            st.dest_sku = sr.dest_sku;
            st.dest_address = peer.address;
            st.dest_udp_port = sr.dest_udp_port;
            st.local_path = sr.source_path;
            st.dest_path = sr.dest_path;
            st.local_node = local_node;
            st.element = element;
            st.rate_hz = (sr.rate_hz > 0.0f && local_node->meta.rate > 0.0f)
                ? std::min(sr.rate_hz, local_node->meta.rate)
                : std::max(sr.rate_hz, local_node->meta.rate);
            st.last_request_ms = now_ms;
            st.monitor = monitor;
            // Send the current value once; a trigger has none (only events)
            st.last_epoch = local_node->change_epoch -
                            (local_node->meta.type == ParamType::Trigger ? 0 : 1);
            st.id = sr.stream_id ? sr.stream_id : next_stream_id();
            st.conn = sr.conn;
            stream_targets_.push_back(st);
            if (!monitor) {
                log("StreamTarget added: %s -> %s:%u (rate=%.1f)",
                    sr.source_path.c_str(), peer.address.c_str(), sr.dest_udp_port, st.rate_hz);
            }
        }
        // Our answer: what the values are. Once per declaration of ours (the
        // request comes again as a keepalive; a new range goes out with it).
        if (!monitor) {
            for (auto& t : stream_targets_) {
                if (t.dest_sku != sr.dest_sku || t.local_path != sr.source_path ||
                    t.dest_path != sr.dest_path || t.replied_decl == decl_version_) continue;
                MsgStreamReply rep;
                rep.source_path = sr.source_path;
                rep.dest_path = sr.dest_path;
                rep.shape.type = element >= 0 ? elem_scalar(local_node->meta.of) : local_node->meta.type;
                rep.shape.mode = local_node->meta.mode;
                if (element < 0) {
                    rep.shape.of = local_node->meta.of;
                    rep.shape.size = local_node->meta.size;
                }
                rep.shape.range_min = local_node->meta.range_min;
                rep.shape.range_max = local_node->meta.range_max;
                rep.stream_id = t.id;
                const size_t len = encode([&](etl::span<uint8_t> buf) {
                    return encode_stream_reply(buf, ++seq_, rep); });
                if (len > 0) {
                    send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
                    t.replied_decl = decl_version_;
                }
                break;
            }
        }
        break;
    }

    case MsgType::Time:
        handle_time(peer, msg.time);
        break;

    case MsgType::Fire: {
        // A trigger from a source, to the one destination it names
        ParamValue v;
        v.tag = ParamType::Trigger;
        arrive(msg.from_sku, msg.fire.source_path, msg.fire.dest_path,
               v, false, msg.fire.at, clock_.millis());   // at its time, if it says one (9.3)
        break;
    }

    case MsgType::StreamReply: {
        // What a source's values are: kept on the connection, for when our
        // world view doesn't hold its declaration
        const auto& rep = msg.stream_reply;
        // The stream's id: its packets can come without their path, and
        // feed this one destination
        if (rep.stream_id) {
            StreamName* name = stream_name(rep.stream_id);   // a number we gave, to this source
            if (name && name->sku == msg.from_sku && name->path == rep.source_path)
                name->dest_path = rep.dest_path;
        }
        if (!rep.shape.known) break;
        for (auto& ie : inbound_stream_)
            if (ie.source_sku == msg.from_sku && ie.source_path == rep.source_path &&
                ie.local_path == rep.dest_path)
                ie.shape = rep.shape;
        break;
    }

    case MsgType::StreamStop: {
        const auto& ss = msg.stream_stop;
        const bool monitor = ss.dest_path.empty();
        if (!monitor) {
            log("StreamStop from %s: source=%s dest=%s/%s",
                msg.from_sku.c_str(), ss.source_path.c_str(),
                ss.dest_sku.c_str(), ss.dest_path.c_str());
        }

        for (size_t i = 0; i < stream_targets_.size(); ++i) {
            auto& t = stream_targets_[i];
            if (t.dest_sku == ss.dest_sku &&
                t.local_path == ss.source_path &&
                t.dest_path == ss.dest_path) {
                if (!monitor)
                    log("StreamTarget removed: %s -> %s", ss.source_path.c_str(), ss.dest_sku.c_str());
                stream_targets_.erase(stream_targets_.begin() + static_cast<ptrdiff_t>(i));
                break;
            }
        }
        break;
    }

    case MsgType::Halt:
        handle_halt(msg.halt.cue, &peer);
        break;

    case MsgType::Locate:
        if (msg.locate.target_sku == identity_.sku) handle_locate(msg.locate);
        break;

    case MsgType::Ended:
        handle_ended(msg.from_sku.c_str(), msg.ended);
        break;

    case MsgType::LinkEdit:
        if (msg.link_edit.dest_sku == identity_.sku &&
            !edit_link(msg.link_edit.id, msg.link_edit.link, msg.link_edit.what))
            log("LINKEDIT from %s: no such connection here", msg.from_sku.c_str());
        break;

    case MsgType::Conns: {
        const auto& cm = msg.conns;
        if (role_ == NodeRole::Source) break;            // it keeps no world view
        if (cm.about_sku == identity_.sku) {
            // Ours, as a peer holds them: a version of ours we don't know
            // (we lost our storage) must not come back over the new one
            if (cm.version > conn_version_) {
                conn_version_ = cm.version;
                connections_changed();
            }
            break;
        }
        NodeEntry* e = world_.find_node(cm.about_sku.c_str());
        if (!e) break;                                    // its DECLARE first; a digest repairs
        // From the node itself, always (it may have started over); relayed,
        // only when newer
        if (cm.about_sku != msg.from_sku && cm.version <= e->conn_version) break;
        e->connections = std::move(const_cast<MsgConns&>(cm).list);
        e->conn_version = cm.version;
        expand_connections(*e);
        log("CONNS about %s (v%u, %u connections) from %s", cm.about_sku.c_str(), cm.version,
            static_cast<unsigned>(e->connections.size()), msg.from_sku.c_str());
        // In presentation a new connection may need a link we didn't keep:
        // look around again, so its two ends find and call each other
        if (phase() == Phase::Presentation && !connected_to(cm.about_sku.c_str()))
            for (const auto& c : e->connections)
                if (c.source_sku == identity_.sku) { mdns_.browse("_dataflou._tcp.local."); break; }
        topology_changed();
        break;
    }

    default:
        break;
    }
}

} // namespace dataflou
