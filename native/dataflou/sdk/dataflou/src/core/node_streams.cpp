// node_streams.cpp — values: sending a source's streams, receiving and
// mapping them, ground, the state of destinations.

#include "node_internal.h"

namespace dataflou {

// --- Range normalization helpers ---
//
// A value goes from its source's range to 0..1, then to its destination's
// range, each in its end's nature: a log range is travelled in log (as a
// ground ramp is). A zero-width range (min == max) means "no range
// declared": a value whose source or destination range is empty passes
// through unchanged instead of collapsing to the destination minimum.

static bool empty_span(double lo, double hi) { return hi == lo; }

static bool log_span(Nature n, double lo, double hi) {
    return n == Nature::Log && lo > 0.0 && hi > 0.0;
}

// Source range → 0-1, one component, clamped (raw value if the source has no range).
static double to_unit(double v, double lo, double hi, Nature n = Nature::Lin) {
    if (empty_span(lo, hi)) return v;
    double t = log_span(n, lo, hi) && v > 0.0 ? std::log(v / lo) / std::log(hi / lo)
                                              : (v - lo) / (hi - lo);
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;
    return t;
}

// 0-1 → destination range, one component (unchanged if the destination has no range).
static double from_unit(double t, double lo, double hi, Nature n = Nature::Lin) {
    if (empty_span(lo, hi)) return t;
    if (t <= 0.0) return lo;            // the ends exactly, whatever the nature
    if (t >= 1.0) return hi;
    return log_span(n, lo, hi) ? lo * std::exp(t * std::log(hi / lo)) : lo + t * (hi - lo);
}

// Source range → destination range, one component.
static double map_range(double v, double smin, double smax, Nature sn,
                        double dmin, double dmax, Nature dn) {
    if (empty_span(smin, smax) || empty_span(dmin, dmax)) return v;
    return from_unit(to_unit(v, smin, smax, sn), dmin, dmax, dn);
}

static Nature nature_of(const ParamMetaCore& m) { return m.nature; }
static Nature nature_of(const SourceShape&) { return Nature::Lin; }

// Same-type range normalization, each end in its nature. The source is its
// declaration (ParamMetaCore) or its stream reply (SourceShape).
template <typename Src>
static void normalize_same_type(ParamValue& val,
                                const Src& src_meta,
                                const ParamMetaCore& dst_meta) {
    const auto& s0 = src_meta.range_min;
    const auto& s1 = src_meta.range_max;
    const auto& d0 = dst_meta.range_min;
    const auto& d1 = dst_meta.range_max;
    const Nature sn = nature_of(src_meta), dn = dst_meta.nature;
    switch (src_meta.type) {
    case ParamType::Number:
        val.n = map_range(val.n, s0.n, s1.n, sn, d0.n, d1.n, dn);
        break;
    case ParamType::V2:
        for (int c = 0; c < 2; ++c)
            val.v2[c] = static_cast<float>(map_range(val.v2[c], s0.v2[c], s1.v2[c], sn, d0.v2[c], d1.v2[c], dn));
        break;
    case ParamType::V3:
        for (int c = 0; c < 3; ++c)
            val.v3[c] = static_cast<float>(map_range(val.v3[c], s0.v3[c], s1.v3[c], sn, d0.v3[c], d1.v3[c], dn));
        break;
    case ParamType::V4:
        for (int c = 0; c < 4; ++c)
            val.v4[c] = static_cast<float>(map_range(val.v4[c], s0.v4[c], s1.v4[c], sn, d0.v4[c], d1.v4[c], dn));
        break;
    default:
        break; // Bool, String, Blob, Colour: pass through unchanged
    }
}

// Normalize a source value into a destination range, with cross-type casting support.
template <typename Src>
static void normalize_value(ParamValue& val,
                            const Src& src_meta,
                            const ParamMetaCore& dst_meta) {
    if (src_meta.type == dst_meta.type) {
        normalize_same_type(val, src_meta, dst_meta);
        return;
    }

    // Cross-type: normalize source to 0-1, cast, then scale to dest range.
    if (!can_cast(src_meta.type, dst_meta.type)) return;

    // Step 1: normalize source to 0-1 range
    const auto& s0 = src_meta.range_min;
    const auto& s1 = src_meta.range_max;
    const Nature sn = nature_of(src_meta), dn = dst_meta.nature;
    ParamValue normalized = val;
    switch (src_meta.type) {
    case ParamType::Number:
        normalized.n = to_unit(val.n, s0.n, s1.n, sn);
        break;
    case ParamType::V2:
        for (int c = 0; c < 2; ++c)
            normalized.v2[c] = static_cast<float>(to_unit(val.v2[c], s0.v2[c], s1.v2[c], sn));
        break;
    case ParamType::V3:
        for (int c = 0; c < 3; ++c)
            normalized.v3[c] = static_cast<float>(to_unit(val.v3[c], s0.v3[c], s1.v3[c], sn));
        break;
    case ParamType::V4:
        for (int c = 0; c < 4; ++c)
            normalized.v4[c] = static_cast<float>(to_unit(val.v4[c], s0.v4[c], s1.v4[c], sn));
        break;
    default:
        break; // Bool, Colour: no source range normalization needed
    }

    // Step 2: cast to destination type
    ParamValue casted;
    if (!value_cast(normalized, dst_meta.type, casted)) return;

    // Step 3: scale the casted 0-1 value into the destination range — once.
    // (Clamping into the destination range first would corrupt any range
    // that doesn't contain [0, 1], e.g. a bool into 1..64.)
    const auto& d0 = dst_meta.range_min;
    const auto& d1 = dst_meta.range_max;
    switch (dst_meta.type) {
    case ParamType::Number:
        casted.n = from_unit(casted.n, d0.n, d1.n, dn);
        break;
    case ParamType::V2:
        for (int c = 0; c < 2; ++c)
            casted.v2[c] = static_cast<float>(from_unit(casted.v2[c], d0.v2[c], d1.v2[c], dn));
        break;
    case ParamType::V3:
        for (int c = 0; c < 3; ++c)
            casted.v3[c] = static_cast<float>(from_unit(casted.v3[c], d0.v3[c], d1.v3[c], dn));
        break;
    case ParamType::V4:
        for (int c = 0; c < 4; ++c)
            casted.v4[c] = static_cast<float>(from_unit(casted.v4[c], d0.v4[c], d1.v4[c], dn));
        break;
    default:
        break;
    }

    val = casted;
}

// --- Transforms (9.1, connection.h) ---

// A curve at t (0..1): through its points, a cubic between each two. Monotone
// (Fritsch–Carlson: never overshoots, so never leaves 0..1 or turns back),
// or free (Catmull-Rom: through the points, may swing past them).
float curve_at(const Curve& c, float t) {
    if (c.straight()) return t;
    const uint8_t n = c.n;
    if (t <= c.x[0]) return c.y[0];
    if (t >= c.x[n - 1]) return c.y[n - 1];
    uint8_t i = 0;
    while (i + 1 < n - 1 && t > c.x[i + 1]) ++i;
    const float h = c.x[i + 1] - c.x[i];
    if (h <= 0.0f) return c.y[i + 1];
    // Slopes: of each segment, then at each point
    auto seg = [&](uint8_t k) {
        const float dx = c.x[k + 1] - c.x[k];
        return dx > 0.0f ? (c.y[k + 1] - c.y[k]) / dx : 0.0f;
    };
    auto tangent = [&](uint8_t k) {
        if (k == 0) return seg(0);
        if (k == n - 1) return seg(static_cast<uint8_t>(n - 2));
        const float a = seg(static_cast<uint8_t>(k - 1)), b = seg(k);
        if (!c.free && a * b <= 0.0f) return 0.0f;      // a turn: flat there
        return (a + b) * 0.5f;
    };
    float m0 = tangent(i), m1 = tangent(static_cast<uint8_t>(i + 1));
    if (!c.free) {                                      // keep it monotone on this segment
        const float d = seg(i);
        if (d == 0.0f) { m0 = m1 = 0.0f; }
        else {
            const float a = m0 / d, b = m1 / d;
            const float r = a * a + b * b;
            if (r > 9.0f) { const float k = 3.0f / std::sqrt(r); m0 = k * a * d; m1 = k * b * d; }
        }
    }
    const float u = (t - c.x[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * c.y[i] + (u3 - 2 * u2 + u) * h * m0 +
           (-2 * u3 + 3 * u2) * c.y[i + 1] + (u3 - u2) * h * m1;
}

static uint8_t components(ParamType t) {
    switch (t) {
    case ParamType::Bool:
    case ParamType::Number: return 1;
    case ParamType::V2:     return 2;
    case ParamType::V3:     return 3;
    case ParamType::V4:
    case ParamType::Colour: return 4;
    default:                return 0;
    }
}

static double get_c(const ParamValue& v, uint8_t i) {
    switch (v.tag) {
    case ParamType::Bool:   return v.b ? 1.0 : 0.0;
    case ParamType::Number: return v.n;
    case ParamType::V2:     return v.v2[i];
    case ParamType::V3:     return v.v3[i];
    case ParamType::V4:     return v.v4[i];
    case ParamType::Colour: return v.rgba[i] / 255.0;
    default:                return 0.0;
    }
}

static double range_c(const ParamValueCore& r, ParamType t, uint8_t i) {
    switch (t) {
    case ParamType::Number: return r.n;
    case ParamType::V2:     return r.v2[i];
    case ParamType::V3:     return r.v3[i];
    case ParamType::V4:     return r.v4[i];
    case ParamType::Bool:
    case ParamType::Colour: return -1.0;   // 0..1 by nature: see below
    default:                return 0.0;
    }
}

// A value through a link's transform: per component, from the source's
// units (its `in`, else its range) to 0..1, through the curve, then to the
// destination's units (its `out`, else its range), in its nature. The type
// is the destination's; a bool destination is on where the curve gives 0.5
// or more (a step in the curve binarizes).
template <typename Src>
static bool transform_value(ParamValue& val, const Src& src, const ParamMetaCore& dst,
                            const Vector<LinkAxis>& axes) {
    const uint8_t sc = components(val.tag), dc = components(dst.type);
    if (!sc || !dc) return false;
    const Nature sn = nature_of(src), dn = dst.nature;
    ParamValue out;
    out.tag = dst.type;
    for (uint8_t i = 0; i < dc; ++i) {
        const uint8_t from = i < sc ? i : static_cast<uint8_t>(sc - 1);
        const LinkAxis* a = i < axes.size() ? &axes[i] : nullptr;
        // In
        double lo = range_c(src.range_min, src.type, from), hi = range_c(src.range_max, src.type, from);
        if (lo == -1.0 && hi == -1.0) { lo = 0.0; hi = 1.0; }
        if (a && a->in_set) { lo = a->in_min; hi = a->in_max; }
        double t = empty_span(lo, hi) ? get_c(val, from) : to_unit(get_c(val, from), lo, hi, sn);
        // The curve
        if (a) t = curve_at(a->curve, static_cast<float>(t));
        if (dst.type == ParamType::Bool) { out.b = t >= 0.5; continue; }
        // Out
        lo = range_c(dst.range_min, dst.type, i);
        hi = range_c(dst.range_max, dst.type, i);
        if (lo == -1.0 && hi == -1.0) { lo = 0.0; hi = 1.0; }
        if (a && a->out_set) { lo = a->out_min; hi = a->out_max; }
        const double v = from_unit(t, lo, hi, dn);
        switch (dst.type) {
        case ParamType::Number: out.n = v; break;
        case ParamType::V2:     out.v2[i] = static_cast<float>(v); break;
        case ParamType::V3:     out.v3[i] = static_cast<float>(v); break;
        case ParamType::V4:     out.v4[i] = static_cast<float>(v); break;
        case ParamType::Colour: out.rgba[i] = static_cast<uint8_t>(std::clamp(v * 255.0, 0.0, 255.0) + 0.5); break;
        default: break;
        }
    }
    val = out;
    return true;
}

// --- Arrays (9.3) ---

// A source's shape, as its stream reply tells it, as a param's
static ParamMetaCore meta_of(const SourceShape& s) {
    ParamMetaCore m;
    m.type = s.type;
    m.mode = s.mode;
    m.of = s.of;
    m.size = s.size;
    m.range_min = s.range_min;
    m.range_max = s.range_max;
    return m;
}

// One element's shape for an array, the param's own for anything else
static ParamMetaCore scalar_side(const ParamMetaCore& m) {
    return m.type == ParamType::Array ? element_meta(m) : m;
}

// A value from a source into a destination when either is an array: element
// by element, each through the link's transform (shared by all of them) or
// from the source's range to the destination's. An array into an array:
// element i to element i, as many as both have (the others keep their
// value); one value into an array: every element; an array into one value:
// its first element. `src`: the source's shape, nullptr when not known (the
// values are then only cast). False if nothing can be made of it.
static bool map_arrays(const ParamValue& value, const ParamMetaCore* src, const ParamMetaCore& dst,
                       const ParamValue& current, const Link* link, ParamValue& out) {
    ParamMetaCore s_el, d_el = scalar_side(dst);
    if (src) s_el = scalar_side(*src);
    auto one = [&](const ParamValue& in, ParamValue& x) {
        x = in;
        bool done = false;
        if (src && link && !link->plain()) done = transform_value(x, s_el, d_el, link->axes);
        if (!done && src) normalize_value(x, s_el, d_el);
        if (x.tag != d_el.type) {
            ParamValue c;
            if (!value_cast(x, d_el.type, c)) return false;
            x = c;
        }
        return true;
    };
    ParamValue x, y;
    if (dst.type != ParamType::Array) {
        if (value.tag == ParamType::Array) { if (!array_get(value, 0, x)) return false; }
        else x = value;
        return one(x, out);
    }
    if (current.tag == ParamType::Array && current.of == dst.of && array_count(current) == dst.size &&
        !current.unknown)
        out = current;
    else
        out = initial_value(dst);
    if (array_count(out) != dst.size) return false;          // out of memory
    if (value.tag == ParamType::Array) {
        const size_t n = std::min(array_count(value), static_cast<size_t>(dst.size));
        for (size_t i = 0; i < n; ++i)
            if (array_get(value, i, x) && one(x, y)) array_put(out, i, y);
    } else {
        if (!one(value, y)) return false;
        for (size_t i = 0; i < dst.size; ++i) array_put(out, i, y);
    }
    return true;
}

// --- Stream keepalive ---

void Node::poll_stream_keepalive() {
    if (inbound_stream_.empty()) return;
    uint64_t now = clock_.millis();
    if (now - last_keepalive_ms_ < STREAM_KEEPALIVE_INTERVAL_MS) return;
    last_keepalive_ms_ = now;

    // Re-send StreamRequests for all inbound streams (destination-driven keepalive)
    for (const auto& ie : inbound_stream_) send_stream_request(ie);
}

// --- Stream polling ---

// Same type, same value (a stream refresh that changes nothing is dropped).
static bool same_value(const ParamValue& a, const ParamValue& b) {
    if (a.tag != b.tag || a.unknown != b.unknown) return false;
    if (a.unknown) return true;
    switch (a.tag) {
    case ParamType::Bool:   return a.b == b.b;
    case ParamType::Number: return a.n == b.n;
    case ParamType::V2:     return std::memcmp(a.v2, b.v2, sizeof(a.v2)) == 0;
    case ParamType::V3:     return std::memcmp(a.v3, b.v3, sizeof(a.v3)) == 0;
    case ParamType::V4:     return std::memcmp(a.v4, b.v4, sizeof(a.v4)) == 0;
    case ParamType::Colour: return std::memcmp(a.rgba, b.rgba, sizeof(a.rgba)) == 0;
    case ParamType::String:
    case ParamType::Blob:   return a.s == b.s;
    case ParamType::Trigger: return false;          // each one is an event of its own
    case ParamType::Array:  return array_same(a, b);
    }
    return false;
}

// "a/b/c" of a local param (no leading slash), whole, written at `at` if
// it fits in `room` with its terminator; nullptr if not. Runs for every value
// sent: it allocates nothing (the length first, then the names from the end).
static const char* path_of(const ParamNode* node, char* at, size_t room) {
    size_t len = 0;
    for (const ParamNode* n = node; n && n->parent; n = n->parent)
        len += n->meta.name.size() + (len ? 1 : 0);
    if (len + 1 > room) return nullptr;
    at[len] = '\0';
    size_t end = len;
    for (const ParamNode* n = node; n && n->parent; n = n->parent) {
        const size_t k = n->meta.name.size();
        std::memcpy(at + end - k, n->meta.name.c_str(), k);
        end -= k;
        if (end > 0) at[--end] = '/';
    }
    return at;
}

// The order a param of ours goes out in a tick: by how many populations it
// is in, its values before its gate
static int pass_of(const ParamNode* n, bool gate) {
    int depth = 0;
    for (const ParamNode* up = n ? n->parent : nullptr; up; up = up->parent)
        if (up->meta.kind == ParamKind::Group && up->meta.slots > 0) ++depth;
    return depth * 2 + (gate ? 1 : 0);
}

void Node::poll_stream() {
    if (udp_socket_ == INVALID_UDP_HANDLE) return;

    uint64_t now = clock_.millis();

    // --- Keepalive timeout sweep: remove expired StreamTargets ---
    for (size_t i = stream_targets_.size(); i > 0; --i) {
        auto& t = stream_targets_[i - 1];
        if (t.last_request_ms > 0 && (now - t.last_request_ms) > STREAM_KEEPALIVE_TIMEOUT_MS) {
            log("StreamTarget expired (keepalive timeout): %s -> %s",
                t.local_path.c_str(), t.dest_sku.c_str());
            stream_targets_.erase(stream_targets_.begin() + static_cast<ptrdiff_t>(i - 1));
        }
    }

    // --- Send phase: values to stream targets, by mode and rate ---
    outgoing_.clear();
    for (auto& target : stream_targets_) {
        if (!target.local_node) continue;
        const bool changed = target.local_node->change_epoch != target.last_epoch;
        const uint64_t since = now - target.last_sent_ms;
        uint64_t interval = target.rate_hz > 0.0f
            ? static_cast<uint64_t>(1000.0f / target.rate_hz) : 0;
        bool refresh = false;
        if (target.monitor) {
            // Monitors: on change, plus a slow refresh against UDP loss
            if (!changed && since < MONITOR_REFRESH_MS) continue;
            if (changed && interval > 0 && since < interval) continue;
        } else if (target.local_node->meta.mode == StreamMode::Streaming) {
            // A continuous stream at its rate; unchanged values as refreshes
            if (interval == 0) interval = static_cast<uint64_t>(1000.0f / STREAMING_DEFAULT_HZ);
            if (since < interval) continue;
            refresh = !changed;
        } else {
            // Discrete (and polling, which has no request yet): on change,
            // capped by rate (a held-back change goes out at the next
            // slot), and a refresh now and then against UDP loss
            if (changed) {
                if (interval > 0 && since < interval) continue;
            } else if (since < DISCRETE_REFRESH_MS) {
                continue;
            } else {
                refresh = true;
            }
        }

        // A trigger is an event: sent once, never refreshed, and to a
        // destination over TCP, which doesn't lose it
        if (target.local_node->meta.type == ParamType::Trigger) {
            if (!changed) continue;
            if (!target.monitor && send_fire(target)) {
                target.last_sent_ms = now;
                target.last_epoch = target.local_node->change_epoch;
                continue;
            }
            refresh = false;
        }
        if (target.dest_address.empty()) continue;
        const bool gate = is_gate(target.local_node);
        // A gate that moved, a param whose every sample counts: each write
        // since the last send (for a stream, at most a packet's worth)
        size_t edges = 0;
        if ((gate || target.local_node->meta.every) && changed && !target.monitor)
            for (const auto& w : written_) {
                if (w.node != target.local_node || static_cast<int32_t>(w.epoch - target.last_epoch) <= 0) continue;
                if (edges >= 64) break;
                Outgoing* o = outgoing_.emplace_back();
                if (!o) break;
                o->target = &target;
                o->gate = gate;
                o->has_value = true;
                o->value = w.value;
                o->stamp = w.stamp;
                o->pass = pass_of(target.local_node, gate);
                ++edges;
            }
        if (edges > 0) continue;
        Outgoing* o = outgoing_.emplace_back();
        if (!o) break;                                  // out of memory: the rest next tick
        o->target = &target;
        o->refresh = refresh && !target.monitor;
        o->gate = gate;
        o->pass = pass_of(target.local_node, gate);
    }
    // Edges every target has sent, or too old to matter
    for (size_t i = written_.size(); i > 0; --i)
        if (now - written_[i - 1].at > 2000)
            written_.erase(written_.begin() + static_cast<ptrdiff_t>(i - 1));
    // What changed in a connection goes with what of it is due: a group's
    // values travel together (a note's velocity with its gate), whatever
    // each one's own rate. A gate that rises takes its whole slot along: the
    // instance it opens may land in a slot another one held, and starts with
    // all its values. A gate that falls takes what its end says (reason,
    // release): an earlier packet that held them may have been lost.
    const size_t due = outgoing_.size();
    for (size_t i = 0; i < due; ++i) {
        const StreamTarget* t = outgoing_[i].target;
        if (t->monitor || t->conn.empty()) continue;
        const bool gate_on = outgoing_[i].has_value ? outgoing_[i].value.b : t->local_node->value.b;
        const bool rises = outgoing_[i].gate && gate_on, falls = outgoing_[i].gate && !gate_on;
        for (auto& other : stream_targets_) {
            const bool slot = other.local_node && other.local_node->parent == t->local_node->parent;
            const bool ends = slot && falls && (other.local_node->meta.role == ParamRole::Reason ||
                                        other.local_node->meta.role == ParamRole::Release);
            const bool same_slot = slot && (rises || ends);
            if (&other == t || other.conn != t->conn || other.dest_sku != t->dest_sku ||
                !other.local_node || other.monitor || other.dest_address.empty() ||
                other.local_node->meta.type == ParamType::Trigger ||
                (other.local_node->change_epoch == other.last_epoch && !same_slot)) continue;
            bool listed = false;
            for (const auto& o : outgoing_) listed = listed || o.target == &other;
            if (listed) continue;
            Outgoing* o = outgoing_.emplace_back();
            if (!o) break;
            o->target = &other;
            o->gate = is_gate(other.local_node);
            o->pass = pass_of(other.local_node, o->gate);
        }
    }
    send_outgoing(now);

    // --- Receive phase: receive values from remote sources ---
    if ((!inbound_stream_.empty() || !monitors_.empty()) && udp_buffer(udp_in_)) {
        uint8_t* recv_buf = udp_in_.data();
        char sender_addr[46];
        uint16_t sender_port = 0;

        int n = udp_.recv_from(udp_socket_, etl::span<uint8_t>(recv_buf, udp_in_.size()),
                               sender_addr, sizeof(sender_addr), sender_port);
        while (n > 0) {
            struct Reading { Node* node; uint32_t sku_hash = 0; int32_t took = -1; uint64_t now = 0;
                             uint32_t sent = 0; bool synced = false; };
            Reading r;
            r.node = this;
            r.now = now;
            uint32_t ts = 0;
            bool synced = false;
            // The header first, for the time the packet took
            {
                const auto pkt = etl::span<const uint8_t>(recv_buf, static_cast<size_t>(n));
                if (pkt.size() >= STREAM_HEADER_SIZE && pkt[0] == STREAM_MAGIC && pkt[1] == STREAM_FORMAT) {
                    synced = (pkt[2] & STREAM_FLAG_SYNCED) != 0;
                    ts = static_cast<uint32_t>(pkt[8]) | (static_cast<uint32_t>(pkt[9]) << 8) |
                         (static_cast<uint32_t>(pkt[10]) << 16) | (static_cast<uint32_t>(pkt[11]) << 24);
                }
            }
            // Both clocks on mesh time: how long the packet took
            if (synced && clock_synced_) {
                const int32_t d = static_cast<int32_t>(static_cast<uint32_t>(mesh_millis()) - ts);
                if (d > -50 && d < 10000) r.took = d < 0 ? 0 : d;
            }
            r.sent = ts;
            r.synced = synced;
            uint32_t hash = 0;
            // The source's sku comes in the header: read before the entries
            if (n >= static_cast<int>(STREAM_HEADER_SIZE))
                r.sku_hash = static_cast<uint32_t>(recv_buf[4]) | (static_cast<uint32_t>(recv_buf[5]) << 8) |
                             (static_cast<uint32_t>(recv_buf[6]) << 16) | (static_cast<uint32_t>(recv_buf[7]) << 24);
            read_stream_packet(etl::span<const uint8_t>(recv_buf, static_cast<size_t>(n)), hash, ts,
                               nullptr, [](const DecodedStreamEntry& e, void* ctx) {
                auto* rd = static_cast<Reading*>(ctx);
                rd->node->receive_entry(rd->sku_hash, e, rd->took, rd->now, rd->sent, rd->synced);
            }, &r);

            n = udp_.recv_from(udp_socket_, etl::span<uint8_t>(recv_buf, udp_in_.size()),
                               sender_addr, sizeof(sender_addr), sender_port);
        }
    }
}

// Each destination's entries of this tick, in as few packets as fit; a
// population's gate after the values that go with it
// A stream packet's buffer, made once, at DATAFLOU_UDP_BUF_SIZE: on the
// node rather than the stack (a board's loop task has a few KB of it)
bool Node::udp_buffer(Vector<uint8_t>& buf) {
    if (buf.size() == DATAFLOU_UDP_BUF_SIZE) return true;
    if (buf.resize(DATAFLOU_UDP_BUF_SIZE)) return true;
    log("Out of memory: no stream buffer (%u bytes)", static_cast<unsigned>(DATAFLOU_UDP_BUF_SIZE));
    return false;
}

void Node::send_outgoing(uint64_t now) {
    if (outgoing_.empty() || !udp_buffer(udp_out_) || !udp_buffer(udp_names_)) return;
    const uint32_t sku_hash = crc32_sku(identity_.sku.c_str());
    uint8_t* pkt = udp_out_.data();
    StreamEntry entries[32];
    // The names of a packet's entries: they fit in a buffer its size, since
    // the packet carries them (each path up to kMaxPathLength, param.h)
    char* names = reinterpret_cast<char*>(udp_names_.data());
    size_t names_used = 0;
    auto name = [&](const StreamTarget* t) -> const char* {
        const size_t room = udp_names_.size() - names_used;
        const char* p = nullptr;
        if (t->element >= 0) {                       // one element: the path it was asked by
            if (t->local_path.size() + 1 <= room) {
                std::memcpy(names + names_used, t->local_path.c_str(), t->local_path.size() + 1);
                p = names + names_used;
            }
        } else {
            p = path_of(t->local_node, names + names_used, room);
        }
        if (p) names_used += std::strlen(p) + 1;
        return p;
    };
    for (size_t first = 0; first < outgoing_.size(); ++first) {
        if (!outgoing_[first].target) continue;           // sent with an earlier destination
        const StreamTarget* dest = outgoing_[first].target;
        // This destination's entries: the values, then the gates
        size_t count = 0, bytes = STREAM_HEADER_SIZE;
        auto flush = [&] {
            if (count == 0) return;
            const size_t len = encode_stream_packet(etl::span<uint8_t>(pkt, udp_out_.size()), sku_hash,
                static_cast<uint32_t>(mesh_millis() & 0xFFFFFFFF),
                etl::span<const StreamEntry>(entries, count), false, clock_synced_);
            if (len == 0) ++dbg_encode_fails_;
            else if (udp_.send_to(udp_socket_, etl::span<const uint8_t>(pkt, len),
                                  dest->dest_address.c_str(), dest->dest_udp_port) > 0)
                ++dbg_stream_sends_;
            else ++dbg_stream_skips_;
            count = 0;
            bytes = STREAM_HEADER_SIZE;
            names_used = 0;
        };
        // Level by level (a population within an instance after it): its
        // values, then its gates
        int last_pass = 1;
        for (size_t i = first; i < outgoing_.size(); ++i)
            if (outgoing_[i].target) last_pass = std::max(last_pass, outgoing_[i].pass);
        for (int pass = 0; pass <= last_pass; ++pass) {
            for (size_t i = first; i < outgoing_.size(); ++i) {
                Outgoing& o = outgoing_[i];
                StreamTarget* t = o.target;
                if (!t || o.pass != pass || t->dest_address != dest->dest_address ||
                    t->dest_udp_port != dest->dest_udp_port) continue;
                // The path goes with the stream's first packets and every
                // refresh; otherwise the id alone
                const bool named = o.refresh || t->monitor || t->named_left > 0 ||
                                   (t->seq & 63) == 0;   // now and then, against a lost name
                if (count == 32) flush();                // a full packet goes before
                                                          // this entry takes a slot
                StreamEntry e;
                e.id = t->id;
                e.type = t->local_node->value.tag;
                e.value = t->local_node->value;
                if (o.has_value) e.value = o.value;        // one edge of a gate, one sample
                if (t->element >= 0) {                     // one element of an array, alone
                    ParamValue x;
                    if (!array_get(e.value, static_cast<size_t>(t->element), x)) {
                        x = ParamValue{};
                        x.tag = elem_scalar(t->local_node->meta.of);
                        x.unknown = true;
                    }
                    e.value = x;
                    e.type = x.tag;
                }
                e.refresh = o.refresh;
                // Its time (9.3), to a node that reads it; to an older one
                // the value alone, true on arrival as before
                e.at = o.has_value ? o.stamp : t->local_node->stamp;
                if (e.at && !timed_to(t->dest_sku.c_str())) e.at = 0;
                if (named && !(e.path = name(t))) {
                    flush();                              // the names buffer is full
                    e.path = name(t);
                }
                const size_t need = stream_entry_size(e);
                if (bytes + need > udp_out_.size()) {
                    flush();
                    if (named) e.path = name(t);          // flush() freed its name's room
                }
                if (t->named_left > 0) --t->named_left;
                e.seq = t->seq++;
                entries[count++] = e;
                bytes += need;
                t->last_sent_ms = now;
                t->last_epoch = t->local_node->change_epoch;
                // Mirror sent value to WorldView so visualizer shows dest updating
                if (auto* dest_entry = t->monitor ? nullptr : world_.find_node(t->dest_sku.c_str()))
                    if (WorldParamNode* dp = dest_entry->params.resolve(t->dest_path.c_str()))
                        dp->value = t->element >= 0 ? e.value : t->local_node->value;
                o.target = nullptr;
            }
        }
        flush();
    }
    outgoing_.clear();
}

// One entry of a packet from a source: its stream named, counted, delivered
void Node::receive_entry(uint32_t sku_hash, const DecodedStreamEntry& e, int32_t took, uint64_t now,
                         uint32_t sent, bool synced) {
    // The number is ours: it says which stream. A packet under it from
    // another source, or naming another path, is not that stream (a stale
    // one, a stranger's, a source whose hash is another's): dropped.
    StreamName* name = stream_name(e.id);
    if (!name) { ++dbg_unnamed_; return; }
    if (name->sku_hash != sku_hash ||
        (e.path && (name->path.size() != e.path_len ||
                    std::memcmp(name->path.c_str(), e.path, e.path_len) != 0))) {
        ++dbg_foreign_;
        return;
    }
    if (e.path && int16_t(e.seq - name->last_seq) < -64)
        name->seen = false;                  // its count far behind: the source started again
    if (name->seen) {
        const int16_t d = static_cast<int16_t>(e.seq - name->last_seq);
        if (d <= 0) { ++name->late; return; }    // older than what we have
        name->lost += static_cast<uint32_t>(d - 1);
    }
    name->seen = true;
    name->last_seq = e.seq;
    ++name->received;
    if (took >= 0)
        name->latency_ms = name->latency_ms < 0 ? static_cast<float>(took)
                                                : name->latency_ms * 0.9f + took * 0.1f;
    // A trigger fires once: never on a refresh
    if (e.type == ParamType::Trigger && e.refresh) return;
    // Its time (9.3), on our mesh clock: from the header's time when both
    // clocks are the mesh's; else from its arrival (the packet taken as
    // instant), which an offset keeps meaningful
    uint64_t at = 0;
    if (e.timed) {
        const uint64_t mesh = mesh_millis();
        const int64_t ahead = synced && clock_synced_
            ? static_cast<int32_t>(sent + static_cast<uint32_t>(e.offset) - static_cast<uint32_t>(mesh))
            : e.offset;
        const int64_t t = static_cast<int64_t>(mesh) + ahead;
        at = t > 0 ? static_cast<uint64_t>(t) : 1;     // 0 says "none"
    }
    arrive(name->sku, name->path, name->dest_path, e.value, e.refresh, at, now);
}

// --- Values that carry their time (9.3) ---

// A peer that reads stamped entries (it says "timed"), or ourselves
bool Node::timed_to(const char* sku) {
    if (identity_.sku == sku) return true;
    const PeerConnection* p = find_peer_by_sku(sku);
    return p && (p->features & FeatTimed);
}

void Node::arrive(const etl::string<36>& sku, const Text& path, const Text& dest_path,
                  const ParamValue& value, bool refresh, uint64_t at, uint64_t now) {
    if (at) {
        const uint64_t mesh = mesh_millis();
        if (at > mesh + hold_horizon_ms_) {
            // Too far ahead: a clock gone wrong, a date in other units. Applied now.
            if (far_logged_ms_ == 0 || now - far_logged_ms_ >= 1000) {
                far_logged_ms_ = now;
                // %u: a board's printf may not know %llu
                auto ms = [](uint64_t x) { return static_cast<unsigned>(x < UINT32_MAX ? x : UINT32_MAX); };
                log("A value from %s %s stamped %u ms ahead (past the %u ms horizon): applied now",
                    sku.c_str(), path.c_str(), ms(at - mesh), ms(hold_horizon_ms_));
            }
        } else if (at > mesh) {
            // Ahead: held until its time. The same stream at the same time
            // again (a refresh, a newer value for it) is not held twice.
            for (auto& h : held_)
                if (h.at == at && h.sku == sku && h.path == path && h.dest_path == dest_path) {
                    if (!refresh) { h.value = value; h.refresh = false; }
                    return;
                }
            if (Held* h = held_.emplace_back()) {
                h->sku = sku;
                h->path = path;
                h->dest_path = dest_path;
                h->value = value;
                h->refresh = refresh;
                h->at = at;
                return;
            }
            log("Out of memory: a stamped value applied now, not at its time");
        }
    }
    const uint64_t was = delivering_at_;
    delivering_at_ = at;
    deliver_value(sku, path, dest_path, value, refresh, now);
    delivering_at_ = was;
}

// Held values whose time has come, earliest first, each as if it arrived now
void Node::poll_held() {
    if (held_.empty()) return;
    const uint64_t now = clock_.millis();
    for (;;) {
        const uint64_t mesh = mesh_millis();
        size_t first = held_.size();
        for (size_t i = 0; i < held_.size(); ++i)
            if (held_[i].at <= mesh && (first == held_.size() || held_[i].at < held_[first].at)) first = i;
        if (first == held_.size()) return;
        Held h = held_[first];
        held_.erase(held_.begin() + static_cast<ptrdiff_t>(first));
        delivering_at_ = h.at;
        deliver_value(h.sku, h.path, h.dest_path, h.value, h.refresh, now);
        delivering_at_ = 0;
    }
}

// A population's gate: sent after the values that go with it
bool Node::is_gate(const ParamNode* n) const {
    if (!n || !n->parent || !n->parent->parent) return false;
    const ParamNode* pop = n->parent->parent;
    return pop->meta.slots > 0 && pop->meta.kind == ParamKind::Group && is_gate_param(n);
}

// --- Stream names: which stream a number we gave stands for ---

Node::StreamName* Node::stream_name(uint16_t id) {
    for (auto& n : stream_names_)
        if (n.id == id) return &n;
    return nullptr;
}

// The number `id` is now this stream's (a number given again is another
// stream: its counts start over)
Node::StreamName* Node::name_stream(const char* sku, uint16_t id, const Text& path, const Text& dest_path) {
    StreamName* n = stream_name(id);
    if (!n) {
        if (!stream_names_.push_back(StreamName{})) return nullptr;   // out of memory: unnamed
        n = &stream_names_.back();
    }
    if (!(n->sku == sku) || !(n->path == path)) *n = StreamName{};
    n->sku = sku;
    n->sku_hash = crc32_sku(sku);
    n->id = id;
    n->path = path;
    n->dest_path = dest_path;
    return n;
}

// A stream stopped: what still comes under its number is dropped
void Node::forget_stream_name(uint16_t id) {
    for (size_t i = 0; i < stream_names_.size(); ++i)
        if (stream_names_[i].id == id) {
            stream_names_.erase(stream_names_.begin() + static_cast<ptrdiff_t>(i));
            return;
        }
}

// A source started again (or went): its packet counts start over
void Node::restart_stream_names(const char* sku) {
    for (auto& n : stream_names_)
        if (n.sku == sku) n.seen = false;
}

// A number for a stream into this node: the next one no stream of ours has,
// so that a number names one stream whoever sends it (`also`: streams just
// stopped, whose last packets may still come). 0 if all are taken.
uint16_t Node::new_inbound_sid(const Vector<InboundEntry>* also) {
    auto taken = [&](uint16_t sid) {
        for (const auto& o : inbound_stream_) if (o.sid == sid) return true;
        if (also) for (const auto& o : *also) if (o.sid == sid) return true;
        for (const auto& m : monitors_) if (m.sid == sid) return true;
        for (const auto& m : monitors_wanted_) if (m.sid == sid) return true;
        return false;
    };
    for (uint16_t tries = 0; tries < STREAM_ID_MAX; ++tries) {
        if (next_inbound_sid_ == 0 || next_inbound_sid_ > STREAM_ID_MAX) next_inbound_sid_ = 1;
        const uint16_t sid = next_inbound_sid_++;
        if (!taken(sid)) return sid;
    }
    return 0;
}

Node::LinkStats Node::link_stats(const char* sku) const {
    LinkStats st;
    for (const auto& n : stream_names_) {
        if (!(n.sku == sku)) continue;
        st.received += n.received;
        st.lost += n.lost;
        st.late += n.late;
        if (n.latency_ms >= 0) {
            st.latency_ms = st.latency_ms < 0 ? n.latency_ms : (st.latency_ms + n.latency_ms) / 2;
        }
    }
    return st;
}

uint16_t Node::next_stream_id() {
    if (next_stream_id_ == 0 || next_stream_id_ > STREAM_ID_MAX) next_stream_id_ = 1;
    return next_stream_id_++;
}

// A trigger to a destination over our TCP link to it. False without one
// (the caller sends it by UDP).
bool Node::send_fire(const StreamTarget& t) {
    PeerConnection* peer = find_peer_by_sku(t.dest_sku.c_str());
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE || !peer->hello_received) return false;
    MsgFire f;
    f.source_path = t.local_path;
    f.dest_path = t.dest_path;
    if (t.local_node) f.at = t.local_node->stamp;   // 9.3: an older node ignores it
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_fire(buf, ++seq_, f); });
    if (len == 0) return false;
    send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    return true;
}

// A value from a source (UDP, or a trigger over TCP) to what listens to it
// here: the visualizer's monitors, and every local destination connected
// to that source path (each with its own range). `dest_path`, when the
// stream's reply said it, keeps it to that one destination.
void Node::deliver_value(const etl::string<36>& sku, const Text& path, const Text& dest_path,
                         const ParamValue& value, bool refresh, uint64_t now) {
    const uint32_t sku_hash = crc32_sku(sku.c_str());
    // Visualizer monitor: value goes to the world view only
    for (auto& m : monitors_) {
        if (m.sku_hash == sku_hash && m.sku == sku && m.path == path) {
            m.waiting = false;                     // answered
            if (auto* ne = world_.find_node(m.sku.c_str())) {
                if (auto* wp = ne->params.resolve(m.path.c_str())) {
                    if (value.tag == ParamType::Trigger) fire_into(wp->value);
                    else wp->value = value;
                    wp->stamp = delivering_at_;    // its mesh time, when stamped (9.3)
                }
            }
            break;
        }
    }

    // Halted (the mesh-wide stop): destinations take nothing
    if (halt_cue_.on) return;

    // Every local destination subscribed to this source path gets
    // the value (each with its own range), not just the first.
    for (auto& ie : inbound_stream_) {
        if (ie.source_sku_hash != sku_hash || !(ie.source_sku == sku) || !(ie.source_path == path) ||
            (!dest_path.empty() && !(ie.local_path == dest_path))) continue;
        if (ie.levels > 0) deliver_poly(ie, value, refresh, now);
        else if (ie.pick_slot) deliver_picked(ie, value, refresh, now);
        else if (ie.local_node) deliver_into(ie, ie.local_node, ie.local_path.c_str(), value, refresh, now);
    }
}

void Node::deliver_into(InboundEntry& ie, ParamNode* dest, const char* dest_path,
                        const ParamValue& value, bool refresh, uint64_t now) {
    // Lazily resolve source param from world view
    if (ie.source_gen != world_gen_) {   // the world moved: look again
        ie.source_node = nullptr;
        ie.source_gen = world_gen_;
    }
    // A source of ours is in our own tree, another node's in the world view;
    // one element of an array ("harmonics/3", 9.3) is a param of the
    // element's type with the array's range
    const ParamMetaCore* source_meta = nullptr;
    ParamMetaCore element;
    size_t index = 0;
    if (ie.source_sku == identity_.sku) {
        if (const ParamNode* own = local_params_.resolve(ie.source_path.c_str()))
            source_meta = &own->meta;
        else if (const ParamNode* arr = resolve_element(local_params_, ie.source_path.c_str(), index))
            source_meta = &(element = element_meta(arr->meta));
    } else {
        const NodeEntry* ne = nullptr;
        if (!ie.source_node) {
            ne = world_.find_node(ie.source_sku.c_str());
            if (ne) ie.source_node = ne->params.resolve(ie.source_path.c_str());
        }
        if (ie.source_node) source_meta = &ie.source_node->meta;
        else if (ne || (ne = world_.find_node(ie.source_sku.c_str())) != nullptr)
            if (const auto* arr = resolve_element(ne->params, ie.source_path.c_str(), index))
                source_meta = &(element = element_meta(arr->meta));
    }

    // The link's transform, when it has one; else the plain mapping, range to range
    const Link* link = ie.conn < connections_.size() && ie.link < connections_[ie.conn].links.size()
                     ? &connections_[ie.conn].links[ie.link] : nullptr;
    // A destination that merges (9.3) takes what its links combine to; an
    // instance's slot is held by one instance at a time: nothing to merge
    const bool merging = ie.local_node == dest && ie.levels == 0 && ie.pick_slot == 0 &&
                         merge_of(dest->meta) != MergeMode::Ltp;
    if (value.unknown) {                           // nothing known: nothing to map
        if (merging) {
            ie.contributes = false;                // and no part in the merge
            ie.leaves_at = 0;
            ParamValue rest;
            if (merged_value(dest, rest)) { receive_value(dest, dest_path, rest, now, true); return; }
        }
        ParamValue u;
        u.tag = dest->meta.type;
        u.of = dest->meta.of;
        u.unknown = true;
        receive_value(dest, dest_path, u, now, refresh);
        return;
    }
    // Arrays: element by element (9.3)
    if (value.tag == ParamType::Array || dest->meta.type == ParamType::Array) {
        ParamMetaCore shape;
        const ParamMetaCore* from = source_meta;
        if (!from && ie.shape.known) from = &(shape = meta_of(ie.shape));
        ParamValue out;
        if (!map_arrays(value, from, dest->meta, dest->value, link, out)) return;
        mirror_source(ie, value);
        if (merging && out.tag == ParamType::Array && out.of == dest->meta.of) {
            // Element by element, as numbers, colours and bools merge below
            ie.last = ParamValueCore{};
            ie.last.tag = ParamType::Array;
            ie.last_elems.assign(out.s.c_str(), out.s.size());
            ie.contributes = true;
            ie.leaves_at = 0;                      // back in time: it stays
            size_t n = 0;
            ParamValue merged;
            if (merged_value(dest, merged, &n)) {
                receive_value(dest, dest_path, merged, now, refresh || n > 1);
                return;
            }
        }
        receive_value(dest, dest_path, out, now, refresh);
        return;
    }
    ParamValue mapped = value;
    bool done = false;
    if (link && !link->plain()) {
        if (source_meta) done = transform_value(mapped, *source_meta, dest->meta, link->axes);
        else if (ie.shape.known) done = transform_value(mapped, ie.shape, dest->meta, link->axes);
    }
    if (!done) {
        if (source_meta) normalize_value(mapped, *source_meta, dest->meta);
        else if (ie.shape.known) normalize_value(mapped, ie.shape, dest->meta);   // a satellite: its reply
    }

    // Mirror raw source value to WorldView so visualizer shows the source
    // param updating
    mirror_source(ie, value);

    // Whatever came, the destination keeps its own type (the source's tree
    // may not be known yet to map it)
    if (mapped.tag != dest->meta.type) {
        ParamValue cast;
        if (!value_cast(mapped, dest->meta.type, cast)) return;
        mapped = cast;
    }
    if (merging) {
        // Mapped to the destination first, then merged; with several links
        // only a result that changes is an event
        ie.last = ParamValueCore(mapped);
        ie.contributes = true;
        ie.leaves_at = 0;                          // back in time: it stays
        size_t n = 0;
        ParamValue out;
        if (merged_value(dest, out, &n)) {
            receive_value(dest, dest_path, out, now, refresh || n > 1);
            return;
        }
    }
    receive_value(dest, dest_path, mapped, now, refresh);
}

// The source's param in the world view shows what it sent, and when it
// was true (its stamp, 9.3)
void Node::mirror_source(const InboundEntry& ie, const ParamValue& value) {
    if (!ie.source_node) return;
    auto* wp = const_cast<WorldParamNode*>(ie.source_node);
    wp->value = value;
    wp->stamp = delivering_at_;
}

// --- Merging at the destination (9.3) ---

// The links that contribute to `dest`, combined by its mode: HTP the
// highest (per channel for a colour, OR for a bool), average the mean (per
// channel; per component for a vector; a bool true when any is: the OR
// too). Only numbers, colours, bools and vectors (avg) get here
// (merge_of), and arrays: element by element, by their element type's
// rule (merged_array).
bool Node::merged_value(const ParamNode* dest, ParamValue& out, size_t* count) const {
    const MergeMode mode = merge_of(dest->meta);
    const ParamType type = dest->meta.type;
    const bool htp = mode == MergeMode::Htp;
    if (type == ParamType::Array) return merged_array(dest, htp, out, count);
    const int comps = type == ParamType::V2 ? 2 : type == ParamType::V3 ? 3 : 4;   // a vector's
    double acc[4] = {};
    size_t n = 0;
    for (const auto& ie : inbound_stream_) {
        if (ie.local_node != dest || !ie.contributes || ie.levels || ie.pick_slot || ie.last.tag != type)
            continue;
        switch (type) {
        case ParamType::Number:
            acc[0] = n == 0 ? ie.last.n : htp ? std::max(acc[0], ie.last.n) : acc[0] + ie.last.n;
            break;
        case ParamType::Colour:
            for (int c = 0; c < 4; ++c) {
                const double x = ie.last.rgba[c];
                acc[c] = n == 0 ? x : htp ? std::max(acc[c], x) : acc[c] + x;
            }
            break;
        case ParamType::Bool:
            acc[0] += ie.last.b ? 1.0 : 0.0;       // how many are on
            break;
        case ParamType::V2:
        case ParamType::V3:
        case ParamType::V4:                        // avg only (merge_of): per component
            for (int c = 0; c < comps; ++c) acc[c] += ie.last.v4[c];
            break;
        default:
            continue;
        }
        ++n;
    }
    if (count) *count = n;
    if (n == 0) return false;
    out = ParamValue{};
    out.tag = type;
    const double k = htp ? 1.0 : static_cast<double>(n);
    switch (type) {
    case ParamType::Number: out.n = acc[0] / k; break;
    case ParamType::Colour:
        for (int c = 0; c < 4; ++c)
            out.rgba[c] = static_cast<uint8_t>(std::clamp(acc[c] / k + 0.5, 0.0, 255.0));
        break;
    case ParamType::Bool: out.b = acc[0] > 0.0; break;   // HTP and avg alike: any on
    case ParamType::V2:
    case ParamType::V3:
    case ParamType::V4:
        for (int c = 0; c < comps; ++c) out.v4[c] = static_cast<float>(acc[c] / k);
        break;
    default: break;
    }
    return true;
}

// An array's merge (9.3): each element as its element type merges alone
// (a number's highest or mean, rounded into an int or a byte; a colour's
// per channel; a bool's OR, in both modes). Entries of another size (a
// destination redeclared) are left out.
bool Node::merged_array(const ParamNode* dest, bool htp, ParamValue& out, size_t* count) const {
    const ElemType of = dest->meta.of;
    const size_t es = elem_size(of);
    const size_t size = dest->meta.size;
    auto counts = [&](const InboundEntry& ie) {
        return ie.local_node == dest && ie.contributes && !ie.levels && !ie.pick_slot &&
               ie.last.tag == ParamType::Array && ie.last_elems.size() == size * es;
    };
    size_t n = 0;
    for (const auto& ie : inbound_stream_)
        if (counts(ie)) ++n;
    if (count) *count = n;
    if (n == 0 || !array_make(out, of, size, ParamValue{})) return false;
    const double k = htp ? 1.0 : static_cast<double>(n);
    for (size_t i = 0; i < size; ++i) {
        double acc[4] = {};
        size_t seen = 0;
        for (const auto& ie : inbound_stream_) {
            if (!counts(ie)) continue;
            const uint8_t* p = reinterpret_cast<const uint8_t*>(ie.last_elems.c_str()) + i * es;
            double x[4] = {};
            int comps = 1;
            switch (of) {
            case ElemType::Float:  { float f; std::memcpy(&f, p, 4); x[0] = f; break; }
            case ElemType::Int:    { int32_t v; std::memcpy(&v, p, 4); x[0] = v; break; }
            case ElemType::Bool:   x[0] = *p ? 1.0 : 0.0; break;   // HTP's max is OR
            case ElemType::Byte:   x[0] = *p; break;
            case ElemType::Colour: comps = 4; for (int c = 0; c < 4; ++c) x[c] = p[c]; break;
            }
            for (int c = 0; c < comps; ++c)
                acc[c] = seen == 0 ? x[c] : htp ? std::max(acc[c], x[c]) : acc[c] + x[c];
            ++seen;
        }
        ParamValue e;
        e.tag = elem_scalar(of);
        switch (of) {
        case ElemType::Bool:
            e.b = acc[0] > 0.0;                    // any on: HTP's highest, avg's sum, alike
            break;
        case ElemType::Colour:
            for (int c = 0; c < 4; ++c)
                e.rgba[c] = static_cast<uint8_t>(std::clamp(acc[c] / k + 0.5, 0.0, 255.0));
            break;
        default:
            e.n = acc[0] / k;                      // array_put rounds an int, clamps a byte
            break;
        }
        array_put(out, i, e);
    }
    return true;
}

// What is left of a merge, applied (a link gone, a source lost); nothing
// left: the value stays, for ground to decide
void Node::remerge(ParamNode* dest, const char* path, uint64_t now) {
    if (merge_of(dest->meta) == MergeMode::Ltp || halt_cue_.on) return;
    ParamValue v;
    if (merged_value(dest, v)) receive_value(dest, path, v, now, true);
}

// --- Smooth and ground (destination side) ---

// Components a glide moves: numbers, vectors, colours. Bools and text jump.
static uint8_t glide_components(ParamType t) {
    switch (t) {
    case ParamType::Number: return 1;
    case ParamType::V2:     return 2;
    case ParamType::V3:     return 3;
    case ParamType::V4:
    case ParamType::Colour: return 4;
    default:                return 0;
    }
}

static double component(const ParamValue& v, uint8_t i) {
    switch (v.tag) {
    case ParamType::Number: return v.n;
    case ParamType::V2:     return v.v2[i];
    case ParamType::V3:     return v.v3[i];
    case ParamType::V4:     return v.v4[i];
    case ParamType::Colour: return v.rgba[i];
    default:                return 0.0;
    }
}

static void set_component(ParamValue& v, uint8_t i, double x) {
    switch (v.tag) {
    case ParamType::Number: v.n = x; break;
    case ParamType::V2:     v.v2[i] = static_cast<float>(x); break;
    case ParamType::V3:     v.v3[i] = static_cast<float>(x); break;
    case ParamType::V4:     v.v4[i] = static_cast<float>(x); break;
    case ParamType::Colour: v.rgba[i] = static_cast<uint8_t>(std::clamp(x, 0.0, 255.0) + 0.5); break;
    default: break;
    }
}

// A value from a connection: straight in (a ramp to init, if one was
// running, stops: the destination is fed again). A refresh of what we have
// is no event.
void Node::receive_value(ParamNode* node, const char* path, const ParamValue& v, uint64_t now,
                         bool refresh) {
    for (size_t i = 0; i < glides_.size(); ++i) {
        if (glides_[i].path == path) {
            glides_.erase(glides_.begin() + static_cast<ptrdiff_t>(i));
            break;
        }
    }
    if (refresh && same_value(v, node->value)) return;
    set_received(node, path, v);
}

// The value written as an event, mirrored to our own entry in the world view.
void Node::set_received(ParamNode* node, const char* path, const ParamValue& v) {
    if (node->meta.type == ParamType::Trigger) {
        fire_into(node->value);
    } else {
        node->value = v;
    }
    node->stamp = delivering_at_;                  // its time, when its source said one (9.3)
    node->dirty = true;
    ++node->change_epoch;
    if (node->meta.every && sample_cb_) sample_cb_(path, node->value, sample_ctx_);
#ifndef DATAFLOU_SLIM_WORLDVIEW
    if (auto* self = world_.find_node(identity_.sku.c_str())) {
        if (auto* wp = self->params.resolve(path); wp && readable(node->meta.access)) {
            wp->value = v;
            wp->stamp = node->stamp;
        }
    }
#endif
}

// Glides move every GLIDE_STEP_MS; each step is an event.
void Node::poll_glides() {
    if (glides_.empty()) return;
    const uint64_t now = clock_.millis();
    for (size_t i = glides_.size(); i > 0; --i) {
        Glide& g = glides_[i - 1];
        const uint64_t dt = now - g.last_ms;
        if (dt < GLIDE_STEP_MS) continue;
        g.last_ms = now;
        bool done = true;
        ParamNode* node = local_params_.resolve(g.path.c_str());
        if (node && glide_components(node->value.tag) == g.count) {
            ParamValue v = node->value;
            for (uint8_t c = 0; c < g.count; ++c) {
                const double step = g.speed[c] * static_cast<double>(dt);
                const double left = g.target[c] - g.pos[c];
                if (g.speed[c] <= 0.0 || (left < 0.0 ? -left : left) <= step) {
                    g.pos[c] = g.target[c];
                } else {
                    g.pos[c] += left > 0.0 ? step : -step;
                    done = false;
                }
                set_component(v, c, g.log_space ? std::exp(g.pos[c]) : g.pos[c]);
            }
            set_received(node, g.path.c_str(), v);
        }
        if (done) {
            if (node && node->dest == DestState::Grounding) {
                // Land on init exactly (a log ramp ends at exp(ln init))
                const ParamValue init = initial_value(node->meta);
                if (!same_value(init, node->value)) set_received(node, g.path.c_str(), init);
                set_destination(node, g.path.c_str(), DestState::Free, node->end_origin);
            }
            glides_.erase(glides_.begin() + static_cast<ptrdiff_t>(i - 1));
        }
    }
}

void Node::mark_offline(const char* sku) {
    // A source lost: what it said for later goes with it (9.3)
    for (size_t i = held_.size(); i > 0; --i)
        if (held_[i - 1].sku == sku) held_.erase(held_.begin() + static_cast<ptrdiff_t>(i - 1));
    world_.mark_offline(sku);
    if (NodeEntry* e = world_.find_node(sku)) e->offline_since_ms = clock_.millis();
    settle_fed_by(sku, EndOrigin::Lost);
}

// --- Destinations ---

size_t Node::live_sources(const ParamNode* node) const {
    size_t live = 0;
    for (const auto& s : node->subscriptions) {
        if (s.source_sku == identity_.sku) { ++live; continue; }
        const NodeEntry* e = world_.find_node(s.source_sku.c_str());
        if (e && e->online) ++live;
    }
    return live;
}

DestState Node::destination_state(const char* path, EndOrigin* origin) const {
    const ParamNode* n = local_params_.resolve(path);
    if (!n) { if (origin) *origin = EndOrigin::None; return DestState::Free; }
    if (origin) *origin = n->end_origin;
    return n->dest;
}

Node::Destination Node::destination(const char* path) const {
    Destination d;
    const ParamNode* n = local_params_.resolve(path);
    if (!n) return d;
    auto live = [&](const etl::istring& sku) {
        if (sku == identity_.sku) return true;
        const NodeEntry* e = world_.find_node(sku.c_str());
        return e && e->online;
    };
    if (n->meta.kind == ParamKind::Param) {
        d.state = n->dest;
        d.origin = n->end_origin;
        d.connections = static_cast<int>(n->subscriptions.size());
        for (const auto& s : n->subscriptions) d.live += live(s.source_sku);
        return d;
    }
    if (n->meta.slots == 0) return d;
    for (const auto& c : connections_)
        if (c.dest == path) { ++d.connections; d.live += live(c.source_sku); }
    d.state = d.live > 0 ? DestState::Bound : DestState::Free;
    d.origin = d.connections > 0 && d.live == 0 ? EndOrigin::Lost : EndOrigin::None;
    return d;
}

void Node::set_destination(ParamNode* node, const char* path, DestState s, EndOrigin o) {
    if (node->dest == s && node->end_origin == o) return;
    node->dest = s;
    node->end_origin = o;
    if (s == DestState::Waiting || s == DestState::Grounding) {
        bool listed = false;
        for (const auto& p : dest_pending_) listed = listed || p == path;
        if (!listed) dest_pending_.push_back(Text(path));
    }
    if (s == DestState::Bound) log("%s: bound", path);
    else log("%s: %s %s", path, to_string(s), to_string(o));
    if (dest_cb_) dest_cb_(path, s, o, dest_ctx_);
}

// Fed by a live connection: bound. Not any more: a source gone (Lost) waits
// a grace first, a decided end (its host, someone outside) doesn't; then
// back to init (ground), or free where it stands.
void Node::settle_destination(ParamNode* node, const char* path, EndOrigin origin) {
    if (node->meta.kind != ParamKind::Param) return;
    if (live_sources(node) > 0 && !halt_cue_.on) {   // halted: not fed, whatever feeds it
        remerge(node, path, clock_.millis());        // a link may have left the merge
        if (node->dest != DestState::Bound) {
            for (size_t i = 0; i < glides_.size(); ++i)
                if (glides_[i].path == path) { glides_.erase(glides_.begin() + static_cast<ptrdiff_t>(i)); break; }
            set_destination(node, path, DestState::Bound, EndOrigin::None);
        }
        return;
    }
    if (node->dest != DestState::Bound && node->dest != DestState::Waiting) return;
    if (origin == EndOrigin::Lost && !node->subscriptions.empty()) {
        if (node->dest == DestState::Bound) {
            node->wait_until = clock_.millis() + dest_grace_ms_;
            set_destination(node, path, DestState::Waiting, EndOrigin::Lost);
        }
        return;
    }
    start_ground(node, path, origin == EndOrigin::None ? node->end_origin : origin);
}

void Node::settle_fed_by(const char* sku, EndOrigin origin) {
    populations_lost(sku, origin == EndOrigin::Lost);
    picks_lost(sku);
    // A lost source leaves the merges after the grace a destination gives
    // it (a brief cut doesn't lower an HTP); back with a value before, it
    // stays; gone for good, it comes in again with its first value
    if (origin == EndOrigin::Lost) {
        const uint64_t at = clock_.millis() + dest_grace_ms_;
        for (auto& ie : inbound_stream_)
            if (ie.source_sku == sku && ie.contributes && !ie.leaves_at) {
                ie.leaves_at = at ? at : 1;
                merge_leaves_ = true;
            }
    }
    for (const auto& ie : inbound_stream_)
        if (ie.source_sku == sku && ie.local_node)
            settle_destination(ie.local_node, ie.local_path.c_str(), origin);
}

// Back to init in the ground durations (per component, by direction: up
// when the value is below init), straight in log for a log param; at once
// for 0 or a type that doesn't glide; no ground: free where it stands. A
// trigger has no value to return to: it is an event, and grounding one
// fired it (a peer heard an onset a second after the source left).
void Node::start_ground(ParamNode* node, const char* path, EndOrigin origin) {
    // An array goes back at once (its elements don't glide yet)
    const ParamValue init = initial_value(node->meta);
    if (!node->meta.grounds() || init.tag == ParamType::String || init.tag == ParamType::Blob ||
        init.tag == ParamType::Trigger) {
        set_destination(node, path, DestState::Free, origin);
        return;
    }
    const uint64_t now = clock_.millis();
    const uint8_t n = glide_components(init.tag);
    const bool log_space = node->meta.nature == Nature::Log && init.tag == ParamType::Number &&
                           node->value.n > 0.0 && init.n > 0.0;
    bool ramp = false;
    double pos[4] = {}, target[4] = {}, speed[4] = {};
    for (uint8_t i = 0; i < n; ++i) {
        const double v = component(node->value, i), t = component(init, i);
        pos[i] = log_space ? std::log(v) : v;
        target[i] = log_space ? std::log(t) : t;
        const float secs = v < t ? node->meta.ground_up : node->meta.ground_down;
        const double dist = std::fabs(target[i] - pos[i]);
        speed[i] = (secs > 0.0f && dist > 0.0) ? dist / (secs * 1000.0) : 0.0;
        ramp = ramp || speed[i] > 0.0;
    }
    if (!ramp) {                                    // at once
        log("Grounded: %s", path);
        receive_value(node, path, init, now, true);
        set_destination(node, path, DestState::Free, origin);
        return;
    }
    Glide* g = nullptr;
    for (auto& x : glides_) if (x.path == path) g = &x;
    if (!g) g = glides_.emplace_back();
    if (!g) {                                       // out of memory: at once
        receive_value(node, path, init, now, true);
        set_destination(node, path, DestState::Free, origin);
        return;
    }
    g->path = path;
    g->count = n;
    g->last_ms = now;
    g->log_space = log_space;
    for (uint8_t i = 0; i < n; ++i) { g->pos[i] = pos[i]; g->target[i] = target[i]; g->speed[i] = speed[i]; }
    set_destination(node, path, DestState::Grounding, origin);
}

// Lost sources whose grace ran out leave the merges they were in: the
// destination takes what the others give
void Node::poll_merge_leaves() {
    if (!merge_leaves_) return;
    const uint64_t now = clock_.millis();
    bool waiting = false;
    for (auto& ie : inbound_stream_) {
        if (!ie.leaves_at) continue;
        if (now < ie.leaves_at) { waiting = true; continue; }
        ie.leaves_at = 0;
        ie.contributes = false;
        if (ie.local_node) remerge(ie.local_node, ie.local_path.c_str(), now);
    }
    merge_leaves_ = waiting;
}

// Connections undone at the last poll; graces that ran out (grounding
// ramps end in poll_glides)
void Node::poll_destinations() {
    poll_merge_leaves();
    if (!ends_pending_.empty()) {
        for (const auto& e : ends_pending_)
            if (ParamNode* n = local_params_.resolve(e.path.c_str()))
                settle_destination(n, e.path.c_str(), e.origin);
        ends_pending_.clear();
    }
    if (dest_pending_.empty()) return;
    const uint64_t now = clock_.millis();
    for (size_t i = dest_pending_.size(); i > 0; --i) {
        const Text path = dest_pending_[i - 1];
        ParamNode* node = local_params_.resolve(path.c_str());
        if (!node || (node->dest != DestState::Waiting && node->dest != DestState::Grounding)) {
            dest_pending_.erase(dest_pending_.begin() + static_cast<ptrdiff_t>(i - 1));
            continue;
        }
        if (node->dest == DestState::Waiting && now >= node->wait_until) {
            if (live_sources(node) > 0) settle_destination(node, path.c_str(), EndOrigin::None);
            else start_ground(node, path.c_str(), EndOrigin::Lost);
        }
    }
}

} // namespace dataflou
