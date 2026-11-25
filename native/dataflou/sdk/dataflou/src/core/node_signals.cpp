// node_signals.cpp — signals that aren't values (9.1): locate (show where a
// param is: a light at full, a nudge) and the mesh-wide stop (halt).

#include "node_internal.h"

namespace dataflou {

namespace {

void put_u32(uint8_t* p, uint32_t v) {
    for (int i = 0; i < 4; ++i) p[i] = static_cast<uint8_t>(v >> (8 * i));
}

uint32_t get_u32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

} // namespace

// --- Locate ---

expected<void, Error> Node::locate(const char* sku, const char* path, uint32_t ms) {
    MsgLocate m;
    m.target_sku = sku;
    m.path = path;
    m.ms = ms;
    if (identity_.sku == sku) {
        handle_locate(m);
        return {};
    }
    PeerConnection* peer = find_peer_by_sku(sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE || !peer->hello_received)
        return unexpected<Error>(Error::NotConnected);
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_locate(buf, ++seq_, m); });
    if (len == 0) return unexpected<Error>(Error::Full);
    send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    return {};
}

// Started, held a while longer, or stopped; it ends on its own if the one
// who asked goes quiet
void Node::handle_locate(const MsgLocate& m) {
    const ParamNode* p = local_params_.resolve(m.path.c_str());
    if (!p || p->meta.kind != ParamKind::Param) return;
    const uint64_t now = clock_.millis();
    for (size_t i = 0; i < locating_.size(); ++i) {
        if (locating_[i].path != m.path) continue;
        if (m.ms > 0) { locating_[i].until = now + m.ms; return; }
        locating_.erase(locating_.begin() + static_cast<ptrdiff_t>(i));
        log("%s: located", m.path.c_str());
        if (locate_cb_) locate_cb_(m.path.c_str(), false, locate_ctx_);
        return;
    }
    if (m.ms == 0) return;
    Locating* l = locating_.emplace_back();
    if (!l) return;
    l->path = m.path;
    l->until = now + m.ms;
    log("%s: locating", m.path.c_str());
    if (locate_cb_) locate_cb_(m.path.c_str(), true, locate_ctx_);
}

void Node::poll_locates() {
    if (locating_.empty()) return;
    const uint64_t now = clock_.millis();
    for (size_t i = locating_.size(); i > 0; --i) {
        if (now < locating_[i - 1].until) continue;
        const Text path = locating_[i - 1].path;
        locating_.erase(locating_.begin() + static_cast<ptrdiff_t>(i - 1));
        if (locate_cb_) locate_cb_(path.c_str(), false, locate_ctx_);
    }
}

bool Node::locating(const char* path) const {
    for (const auto& l : locating_)
        if (l.path == path) return true;
    return false;
}

// --- Halt ---
//
// Storage: "halt" holds [1] format (1), [1] on, [4] counter, [4] origin (LE).

void Node::halt(bool on) {
    HaltCue cue;
    cue.on = on;
    cue.stamp = next_scene_stamp();
    handle_halt(cue, nullptr);
}

// From the host (from == nullptr), a peer's HALT, or its HELLO or DIGEST.
// Forwarded once by each node it is new to, like the phase; a node that
// misses it gets it from a digest.
void Node::handle_halt(const HaltCue& cue, const PeerConnection* from) {
    if (cue.stamp.empty()) return;
    if (SceneStamp::later(cue.stamp.counter, scene_clock_)) scene_clock_ = cue.stamp.counter;
    if (!cue.stamp.newer_than(halt_cue_.stamp)) return;
    const bool was = halt_cue_.on;
    halt_cue_ = cue;
    persist_halt();
    scenes_dirty_ = true;                              // the clock
    MsgHalt msg;
    msg.cue = cue;
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_halt(buf, ++seq_, msg); });
    if (len > 0) {
        const auto payload = etl::span<const uint8_t>(encode_buf_.data(), len);
        for (auto& peer : peers_)
            if (&peer != from && peer.socket != INVALID_SOCKET_HANDLE && peer.hello_received)
                send_framed(peer.socket, payload);
    }
    if (cue.on != was) apply_halt();
}

// On: every destination fed by a connection returns to its init, every
// population's instances close; off: they are fed again (values flow, and
// the next refresh restores each)
void Node::apply_halt() {
    const uint64_t now = clock_.millis();
    log("Halt: %s", halt_cue_.on ? "on" : "off");
    if (halt_cue_.on) {
        cut_instances(EndOrigin::Outside, now);
        for (const auto& ie : inbound_stream_) {
            ParamNode* n = ie.local_node;
            if (!n || n->dest == DestState::Free || n->dest == DestState::Grounding) continue;
            start_ground(n, ie.local_path.c_str(), EndOrigin::Outside);
        }
    } else {
        for (const auto& ie : inbound_stream_)
            if (ie.local_node) settle_destination(ie.local_node, ie.local_path.c_str(), EndOrigin::None);
    }
    topology_changed();
    if (halt_cb_) halt_cb_(halt_cue_.on, halt_ctx_);
}

void Node::load_halt() {
    halt_cue_ = HaltCue{};
    uint8_t b[10];
    size_t len = 0;
    if (storage_.read("halt", etl::span<uint8_t>(b), len) && len >= 10 && b[0] == 1) {
        halt_cue_.on = b[1] == 1;
        halt_cue_.stamp.counter = get_u32(b + 2);
        halt_cue_.stamp.origin = get_u32(b + 6);
    }
}

void Node::persist_halt() {
    uint8_t b[10];
    b[0] = 1;
    b[1] = halt_cue_.on ? 1 : 0;
    put_u32(b + 2, halt_cue_.stamp.counter);
    put_u32(b + 6, halt_cue_.stamp.origin);
    storage_.write("halt", etl::span<const uint8_t>(b, sizeof(b)));
}

} // namespace dataflou
