// node_clock.cpp — the mesh clock (9.0): one time for every node, without a
// master chosen by anyone.
//
// Each node follows a reference: the lowest sku hash among the nodes that
// are synced (itself included, once it is). It pings the peer that carries
// that reference (TIME) and takes as its offset the estimate of the ping
// with the shortest round trip among the last few. The reference keeps the
// offset it had, so its mesh time goes on without a jump; and a node that
// arrives copies the mesh's time before it can become the reference, so a
// new reference doesn't make the others jump either. A node alone is synced
// to itself after a short wait.

#include "node_internal.h"

namespace dataflou {

static constexpr uint64_t CLOCK_ALONE_MS      = 3000;  // alone this long: its own reference
static constexpr uint64_t CLOCK_PING_FAST_MS  = 200;   // first pings to a new reference
static constexpr uint64_t CLOCK_PING_MS       = 2000;
static constexpr uint32_t CLOCK_MAX_RTT_MS    = 2000;  // a slower answer says nothing useful

ClockState Node::clock_state() const {
    ClockState c;
    c.ref = clock_ref_;
    c.synced = clock_synced_;
    return c;
}

// A reference still there: a node online in our world (or the peer that
// names it). A node gone stays named by those that followed it until they
// hear better: without this, two of them would go on following each other.
bool Node::clock_ref_alive(uint32_t ref, const PeerConnection& via) const {
    if (ref == crc32_sku(via.sku.c_str())) return true;
    for (const auto& e : world_.nodes())
        if (e.online && crc32_sku(e.identity.sku.c_str()) == ref) return true;
    return false;
}

void Node::poll_clock() {
    const uint64_t now = clock_.millis();
    const uint32_t self = crc32_sku(identity_.sku.c_str());
    const ClockState before = clock_state();
    poll_clock_choice(now, self);
    // Told at once (a digest carries it), not at the next digest
    const ClockState after = clock_state();
    if (after.ref != before.ref || after.synced != before.synced) {
        for (auto& p : peers_)
            if (p.socket != INVALID_SOCKET_HANDLE && !p.retired && p.hello_received) send_digest(p);
    }
}

void Node::poll_clock_choice(uint64_t now, uint32_t self) {

    // The best reference in reach: ours if we are synced, or one a synced
    // peer follows
    uint32_t best = clock_synced_ ? self : UINT32_MAX;
    PeerConnection* via = nullptr;
    for (auto& p : peers_) {
        if (p.socket == INVALID_SOCKET_HANDLE || p.retired || !p.hello_received) continue;
        if (!(p.features & FeatClock) || !p.clock.synced) continue;
        if (!clock_ref_alive(p.clock.ref, p)) continue;
        if (p.clock.ref < best || (p.clock.ref == best && via && p.clock_rtt < via->clock_rtt)) {
            best = p.clock.ref;
            via = &p;
        }
    }

    if (!via) {
        if (!clock_synced_ && now - clock_started_ms_ >= CLOCK_ALONE_MS) {
            clock_synced_ = true;                     // alone: our own time is the mesh's
            log("Mesh clock: our own (no synced peer)");
        }
        if (clock_synced_ && clock_ref_ != self) {
            clock_ref_ = self;                        // the one we followed is gone: we lead
            log("Mesh clock: our own (offset %lld ms kept)", static_cast<long long>(clock_offset_ms_));
        }
        clock_via_.clear();
        return;
    }

    if (clock_via_ != via->sku) {                     // a new peer to follow: fresh samples
        clock_via_ = via->sku;
        clock_samples_ = 0;
        last_clock_ping_ms_ = 0;
    }
    const uint64_t every = clock_samples_ < 4 ? CLOCK_PING_FAST_MS : CLOCK_PING_MS;
    if (now - last_clock_ping_ms_ < every) return;
    last_clock_ping_ms_ = now;
    MsgTime t;
    t.t0 = static_cast<uint32_t>(now);
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_time(buf, ++seq_, t); });
    if (len > 0) send_framed(via->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
}

void Node::handle_time(PeerConnection& peer, const MsgTime& t) {
    const uint64_t now = clock_.millis();
    if (!t.reply) {                                   // a ping: our mesh time, now
        MsgTime r;
        r.reply = true;
        r.t0 = t.t0;
        r.mesh = mesh_millis();
        r.clock = clock_state();
        const size_t len = encode([&](etl::span<uint8_t> buf) {
            return encode_time(buf, ++seq_, r); });
        if (len > 0) send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        return;
    }

    peer.clock = t.clock;
    const uint32_t rtt = static_cast<uint32_t>(now) - t.t0;
    if (rtt > CLOCK_MAX_RTT_MS) return;
    peer.clock_rtt = rtt;
    if (peer.sku != clock_via_ || !t.clock.synced) return;

    // Its mesh time half a round trip ago, against ours now
    const int64_t offset = static_cast<int64_t>(t.mesh) + rtt / 2 - static_cast<int64_t>(now);
    ClockSample& s = clock_window_[clock_samples_ % CLOCK_WINDOW];
    s.offset = offset;
    s.rtt = rtt;
    ++clock_samples_;
    const size_t n = clock_samples_ < CLOCK_WINDOW ? clock_samples_ : CLOCK_WINDOW;
    const ClockSample* bestS = &clock_window_[0];
    for (size_t i = 1; i < n; ++i)
        if (clock_window_[i].rtt < bestS->rtt) bestS = &clock_window_[i];

    const bool first = !clock_synced_ || clock_ref_ != t.clock.ref;
    clock_offset_ms_ = bestS->offset;
    clock_rtt_ms_ = bestS->rtt;
    clock_ref_ = t.clock.ref;
    if (first) {
        clock_synced_ = true;
        log("Mesh clock: following %08x through %s (offset %lld ms, rtt %u ms)",
            static_cast<unsigned>(clock_ref_), peer.sku.c_str(),
            static_cast<long long>(clock_offset_ms_), static_cast<unsigned>(rtt));
    }
}

} // namespace dataflou
