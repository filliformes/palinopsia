// node_picks.cpp — a connection that takes one instance of a source
// population to a plain group or param (9.1, connection.h): the source's
// slots as they live, which one the pick names (by id, or by rank among the
// live ones), and the switch from one to the next.
// docs/couches.md, "Router une instance".

#include "node_internal.h"

namespace dataflou {

namespace {

bool truthy(const ParamValue& v) {
    switch (v.tag) {
    case ParamType::Bool:   return v.b;
    case ParamType::Number: return v.n >= 0.5;
    default:                return false;
    }
}

double numeric(const ParamValue& v) {
    switch (v.tag) {
    case ParamType::Bool:   return v.b ? 1.0 : 0.0;
    case ParamType::Number: return v.n;
    default:                return 0.0;
    }
}

} // namespace

Node::Picked* Node::picked(const ConnectionId& conn) {
    for (auto& p : picked_)
        if (p.conn == conn) return &p;
    return nullptr;
}

// The source's slot the pick names now: the live one with its id, or the
// n-th oldest (rank n) or newest (rank -n) of the live ones; 0 none
uint8_t Node::picked_slot(const Picked& pk) const {
    if (pk.pick.kind == Pick::Id) {
        for (size_t j = 0; j < pk.slots.size(); ++j) {
            const PickedSlot& s = pk.slots[j];
            if (s.live && s.has_id && s.id == pk.pick.value) return static_cast<uint8_t>(j + 1);
        }
        return 0;
    }
    if (pk.pick.kind != Pick::Rank) return 0;
    const int r = static_cast<int>(pk.pick.value);
    const bool newest = r < 0;
    const int n = newest ? -r : r;
    uint32_t bound = newest ? UINT32_MAX : 0;
    uint8_t at = 0;
    for (int i = 0; i < n; ++i) {               // slots are few: a scan per rank
        at = 0;
        uint32_t best = newest ? 0 : UINT32_MAX;
        for (size_t j = 0; j < pk.slots.size(); ++j) {
            const PickedSlot& s = pk.slots[j];
            if (!s.live) continue;
            if (newest ? (s.order < bound && s.order > best) : (s.order > bound && s.order < best)) {
                best = s.order;
                at = static_cast<uint8_t>(j + 1);
            }
        }
        if (!at) return 0;
        bound = best;
    }
    return at;
}

// One link's value from the picked slot into its destination param
void Node::feed_picked(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now) {
    if (ie.conn >= connections_.size() || ie.link >= connections_[ie.conn].links.size()) return;
    const Connection& c = connections_[ie.conn];
    Text path;
    join_path(c.dest.c_str(), c.links[ie.link].dest.c_str(), path);
    ParamNode* d = local_params_.resolve(path.c_str());
    if (!d || d->meta.kind != ParamKind::Param ||
        (d->meta.flow != FlowDir::Destination && d->meta.flow != FlowDir::Bidir)) return;
    deliver_into(ie, d, path.c_str(), value, refresh, now);
}

// Another slot picked: its last values, its gate last, as if it had just
// opened there; none: the destination keeps what it has
void Node::repick(Picked& pk, uint64_t now) {
    const uint8_t next = picked_slot(pk);
    if (next == pk.current) return;
    pk.current = next;
    if (!next) return;
    for (int gate = 0; gate < 2; ++gate)
        for (auto& ie : inbound_stream_) {
            if (ie.pick_slot != next || ie.id != pk.conn || ie.link >= pk.links) continue;
            if ((ie.role == ParamRole::Gate) != (gate == 1)) continue;
            const size_t at = size_t(next - 1) * pk.links + ie.link;
            if (at < pk.have.size() && pk.have[at]) feed_picked(ie, pk.last[at], false, now);
        }
}

void Node::deliver_picked(InboundEntry& ie, const ParamValue& value, bool refresh, uint64_t now) {
    Picked* pk = picked(ie.id);
    if (!pk || ie.pick_slot == 0 || ie.pick_slot > pk->slots.size()) return;
    const uint8_t k = ie.pick_slot;
    PickedSlot& s = pk->slots[k - 1];
    const bool linked = ie.link < pk->links;
    if (linked) {
        const size_t at = size_t(k - 1) * pk->links + ie.link;
        if (at < pk->last.size()) { pk->last[at] = value; pk->have[at] = 1; }
    }
    bool moved = false;
    if (ie.role == ParamRole::Gate) {
        const bool on = truthy(value);
        if (on != s.live) {
            s.live = on;
            if (on) s.order = ++pk->order;
            moved = true;
        }
    } else if (ie.role == ParamRole::Id) {
        const double id = numeric(value);
        if (!s.has_id || s.id != id) {
            s.has_id = true;
            s.id = id;
            moved = pk->pick.kind == Pick::Id;
        }
    }
    if (!pk->gated && !s.live) {                 // no gate: a slot lives from its first value
        s.live = true;
        s.order = ++pk->order;
        moved = true;
    }
    const uint8_t next = moved ? picked_slot(*pk) : pk->current;
    if (next == pk->current) {
        if (k == next && linked) feed_picked(ie, value, refresh, now);
        return;
    }
    // The picked instance changes. Its gate falling with none to take over
    // goes through (the destination's note ends); another taking over is
    // legato: its values come, its gate stays up.
    if (k == pk->current && next == 0 && linked) feed_picked(ie, value, refresh, now);
    repick(*pk, now);
}

// The source is gone or back: its slots live no more until they say so
void Node::picks_lost(const char* sku) {
    for (auto& pk : picked_) {
        const Connection* c = find_connection(pk.conn);
        if (!c || !(c->source_sku == sku)) continue;
        for (auto& s : pk.slots) s = PickedSlot{};
        pk.current = 0;
    }
}

} // namespace dataflou
