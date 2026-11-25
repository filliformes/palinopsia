#include "stream_codec.h"
#include "dataflou/array.h"
#include <cstring>

namespace dataflou {

// ---- Little-endian helpers ----

static void write_u16(uint8_t* p, uint16_t v) {
    p[0] = static_cast<uint8_t>(v & 0xFF);
    p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
}

static void write_u32(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v & 0xFF);
    p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
    p[2] = static_cast<uint8_t>((v >> 16) & 0xFF);
    p[3] = static_cast<uint8_t>((v >> 24) & 0xFF);
}

static uint16_t read_u16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) |
           (static_cast<uint16_t>(p[1]) << 8);
}

static uint32_t read_u32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) |
           (static_cast<uint32_t>(p[3]) << 24);
}

static void write_float(uint8_t* p, float v) {
    uint32_t bits;
    memcpy(&bits, &v, 4);
    write_u32(p, bits);
}

static float read_float(const uint8_t* p) {
    uint32_t bits = read_u32(p);
    float v;
    memcpy(&v, &bits, 4);
    return v;
}

static void write_double(uint8_t* p, double v) {
    uint64_t bits;
    memcpy(&bits, &v, 8);
    for (int i = 0; i < 8; ++i) {
        p[i] = static_cast<uint8_t>((bits >> (i * 8)) & 0xFF);
    }
}

static double read_double(const uint8_t* p) {
    uint64_t bits = 0;
    for (int i = 0; i < 8; ++i) {
        bits |= static_cast<uint64_t>(p[i]) << (i * 8);
    }
    double v;
    memcpy(&v, &bits, 8);
    return v;
}

// ---- Arrays (9.3) ----
//
// [1] the element type (its 5 low bits; for bools, the 3 high bits say how
// many bits of the last byte are not elements), then the elements: floats
// and ints 4 bytes each (LE), colours 4 (RGBA), bytes 1, bools a bit each
// (the first element in bit 0 of the first byte). The entry's length says
// how many.

static constexpr uint8_t ELEM_TYPE_MASK = 0x1F;

size_t array_wire_size(const ParamValue& v) {
    return 1 + elem_wire_bytes(v.of, array_count(v));
}

void write_array(uint8_t* p, const ParamValue& v) {
    const size_t n = array_count(v);
    const uint8_t* e = array_bytes(v);
    uint8_t t = static_cast<uint8_t>(v.of);
    if (v.of == ElemType::Bool) t |= static_cast<uint8_t>(((8 - n % 8) % 8) << 5);
    *p++ = t;
    switch (v.of) {
    case ElemType::Float:
    case ElemType::Int:
        for (size_t i = 0; i < n; ++i) {
            uint32_t bits;
            memcpy(&bits, e + 4 * i, 4);
            write_u32(p + 4 * i, bits);
        }
        break;
    case ElemType::Colour:
    case ElemType::Byte:
        memcpy(p, e, n * elem_size(v.of));
        break;
    case ElemType::Bool:
        memset(p, 0, (n + 7) / 8);
        for (size_t i = 0; i < n; ++i)
            if (e[i]) p[i / 8] = static_cast<uint8_t>(p[i / 8] | (1u << (i % 8)));
        break;
    }
}

// False if it is not one this node reads (an element type it doesn't know,
// a length that isn't whole elements, too many)
bool read_array(const uint8_t* d, size_t len, ParamValue& v) {
    if (len < 1) return false;
    const uint8_t t = d[0] & ELEM_TYPE_MASK;
    if (!known_elem(t)) return false;
    const ElemType of = static_cast<ElemType>(t);
    const size_t bytes = len - 1;
    size_t n = 0;
    if (of == ElemType::Bool) {
        const size_t unused = d[0] >> 5;
        if (bytes == 0 || unused > 7) return false;
        n = bytes * 8 - unused;
    } else {
        if (bytes % elem_size(of) != 0) return false;
        n = bytes / elem_size(of);
    }
    if (n == 0 || n > max_array_size(of)) return false;
    if (!array_make(v, of, n, ParamValue{})) return false;
    uint8_t* e = reinterpret_cast<uint8_t*>(const_cast<char*>(v.s.c_str()));
    const uint8_t* p = d + 1;
    switch (of) {
    case ElemType::Float:
    case ElemType::Int:
        for (size_t i = 0; i < n; ++i) {
            const uint32_t bits = read_u32(p + 4 * i);
            memcpy(e + 4 * i, &bits, 4);
        }
        break;
    case ElemType::Colour:
    case ElemType::Byte:
        memcpy(e, p, n * elem_size(of));
        break;
    case ElemType::Bool:
        for (size_t i = 0; i < n; ++i) e[i] = (p[i / 8] >> (i % 8)) & 1u;
        break;
    }
    return true;
}

// ---- Values ----

static size_t value_size(ParamType t, const ParamValue& v) {
    switch (t) {
        case ParamType::Bool:    return 1;
        case ParamType::Number:  return 8;
        case ParamType::V2:      return 8;
        case ParamType::V3:      return 12;
        case ParamType::V4:      return 16;
        case ParamType::Colour:  return 4;
        case ParamType::Trigger: return 0;
        case ParamType::String:
        case ParamType::Blob:    return 2 + v.s.size();
        case ParamType::Array:   return array_wire_size(v);
    }
    return 0;
}

static void write_value(uint8_t* p, ParamType t, const ParamValue& v) {
    switch (t) {
        case ParamType::Bool:   p[0] = v.b ? 1 : 0; break;
        case ParamType::Number: write_double(p, v.n); break;
        case ParamType::V2:     for (int c = 0; c < 2; ++c) write_float(p + 4 * c, v.v2[c]); break;
        case ParamType::V3:     for (int c = 0; c < 3; ++c) write_float(p + 4 * c, v.v3[c]); break;
        case ParamType::V4:     for (int c = 0; c < 4; ++c) write_float(p + 4 * c, v.v4[c]); break;
        case ParamType::Colour: memcpy(p, v.rgba, 4); break;
        case ParamType::Trigger: break;
        case ParamType::String:
        case ParamType::Blob:
            write_u16(p, static_cast<uint16_t>(v.s.size()));
            memcpy(p + 2, v.s.c_str(), v.s.size());
            break;
        case ParamType::Array: write_array(p, v); break;
    }
}

// False if the value runs past `len`
static bool read_value(const uint8_t* d, size_t& pos, size_t len, ParamType t, ParamValue& v) {
    v.tag = t;
    switch (t) {
        case ParamType::Bool:
            if (pos + 1 > len) return false;
            v.b = d[pos] != 0; pos += 1; return true;
        case ParamType::Number:
            if (pos + 8 > len) return false;
            v.n = read_double(d + pos); pos += 8; return true;
        case ParamType::V2:
            if (pos + 8 > len) return false;
            for (int c = 0; c < 2; ++c) v.v2[c] = read_float(d + pos + 4 * c);
            pos += 8; return true;
        case ParamType::V3:
            if (pos + 12 > len) return false;
            for (int c = 0; c < 3; ++c) v.v3[c] = read_float(d + pos + 4 * c);
            pos += 12; return true;
        case ParamType::V4:
            if (pos + 16 > len) return false;
            for (int c = 0; c < 4; ++c) v.v4[c] = read_float(d + pos + 4 * c);
            pos += 16; return true;
        case ParamType::Colour:
            if (pos + 4 > len) return false;
            memcpy(v.rgba, d + pos, 4); pos += 4; return true;
        case ParamType::Trigger:
            return true;
        case ParamType::String:
        case ParamType::Blob: {
            if (pos + 2 > len) return false;
            const uint16_t n = read_u16(d + pos);
            pos += 2;
            if (pos + n > len) return false;
            v.s.assign(reinterpret_cast<const char*>(d + pos), n);
            pos += n;
            return true;
        }
        case ParamType::Array:      // the whole entry: its length says how many
            if (!read_array(d + pos, len - pos, v)) return false;
            pos = len;
            return true;
    }
    return false;
}

// ---- Encode ----

// A timed entry (9.3): its offset and its value's type before the value
static constexpr size_t TIMED_PREFIX = 5;

size_t stream_entry_size(const StreamEntry& e) {
    const size_t path_len = e.path ? strlen(e.path) : 0;
    const size_t vsize = e.value.unknown ? 0 : value_size(e.type, e.value);
    return 4 + (e.path ? 1 + path_len : 0) + 1 + 2 + (e.at ? TIMED_PREFIX : 0) + vsize;
}

size_t encode_stream_packet(etl::span<uint8_t> buf,
    uint32_t sku_hash, uint32_t time_ms,
    etl::span<const StreamEntry> entries, bool refresh, bool synced)
{
    const size_t max = buf.size();
    const size_t count = entries.size();
    if (max < STREAM_HEADER_SIZE || count == 0 || count > 0xFFFF) return 0;

    uint8_t* p = buf.data();
    p[0] = STREAM_MAGIC;
    p[1] = STREAM_FORMAT;
    p[2] = static_cast<uint8_t>(synced ? STREAM_FLAG_SYNCED : 0);
    p[3] = 0;
    write_u32(p + 4, sku_hash);
    write_u32(p + 8, time_ms);
    write_u16(p + 12, static_cast<uint16_t>(count));
    write_u16(p + 14, 0);

    size_t pos = STREAM_HEADER_SIZE;
    for (size_t i = 0; i < count; ++i) {
        const auto& e = entries[i];
        if (e.id == 0 || e.id > STREAM_ID_MAX) return 0;
        const size_t path_len = e.path ? strlen(e.path) : 0;
        if (path_len > 255) return 0;
        const size_t vsize = e.value.unknown ? 0 : value_size(e.type, e.value);   // unknown: no value
        const size_t prefix = e.at ? TIMED_PREFIX : 0;
        if (prefix + vsize > 0xFFFF) return 0;
        const size_t need = 4 + (e.path ? 1 + path_len : 0) + 1 + 2 + prefix + vsize;
        if (pos + need > max) return 0;

        write_u16(p + pos, static_cast<uint16_t>(e.id | (e.path ? STREAM_ID_NAMED : 0)));
        write_u16(p + pos + 2, e.seq);
        pos += 4;
        if (e.path) {
            p[pos++] = static_cast<uint8_t>(path_len);
            memcpy(p + pos, e.path, path_len);
            pos += path_len;
        }
        const uint8_t kind = e.at ? STREAM_KIND_TIMED : static_cast<uint8_t>(e.type);
        p[pos++] = static_cast<uint8_t>(kind | (refresh || e.refresh ? STREAM_ENTRY_REFRESH : 0));
        write_u16(p + pos, static_cast<uint16_t>(prefix + vsize));
        pos += 2;
        if (prefix) {
            // The offset from the header's time: both are the mesh's lower
            // 32 bits, so the difference holds across their wrap
            write_u32(p + pos, static_cast<uint32_t>(e.at) - time_ms);
            p[pos + 4] = static_cast<uint8_t>(e.type);
            pos += prefix;
        }
        if (vsize) write_value(p + pos, e.type, e.value);
        pos += vsize;
    }
    return pos;
}

// ---- Decode ----

size_t read_stream_packet(etl::span<const uint8_t> data,
    uint32_t& sku_hash, uint32_t& time_ms, bool* synced, StreamEntryFn fn, void* ctx)
{
    const size_t len = data.size();
    const uint8_t* d = data.data();
    if (len < STREAM_HEADER_SIZE || d[0] != STREAM_MAGIC || d[1] != STREAM_FORMAT) return 0;
    if (synced) *synced = (d[2] & STREAM_FLAG_SYNCED) != 0;
    sku_hash = read_u32(d + 4);
    time_ms  = read_u32(d + 8);
    const uint16_t count = read_u16(d + 12);

    size_t pos = STREAM_HEADER_SIZE;
    size_t decoded = 0;
    DecodedStreamEntry e;
    for (uint16_t i = 0; i < count; ++i) {
        if (pos + 4 > len) break;
        const uint16_t raw = read_u16(d + pos);
        e.id  = static_cast<uint16_t>(raw & STREAM_ID_MAX);
        e.seq = read_u16(d + pos + 2);
        pos += 4;
        e.path = nullptr;
        e.path_len = 0;
        if (raw & STREAM_ID_NAMED) {
            if (pos + 1 > len) break;
            e.path_len = d[pos++];
            if (pos + e.path_len > len) break;
            e.path = reinterpret_cast<const char*>(d + pos);
            pos += e.path_len;
        }
        if (pos + 3 > len || e.id == 0) break;
        uint8_t tag = static_cast<uint8_t>(d[pos] & ~STREAM_ENTRY_REFRESH);
        e.refresh = (d[pos] & STREAM_ENTRY_REFRESH) != 0;
        const size_t vlen = read_u16(d + pos + 1);
        pos += 3;
        if (pos + vlen > len) break;
        const size_t next = pos + vlen;
        // A value with its time (9.3): the offset, then the value's own kind
        e.timed = false;
        e.offset = 0;
        if (tag == STREAM_KIND_TIMED) {
            if (vlen < TIMED_PREFIX) { pos = next; continue; }
            e.timed = true;
            e.offset = static_cast<int32_t>(read_u32(d + pos));
            tag = d[pos + 4];
            pos += TIMED_PREFIX;
        }
        // A kind this node doesn't know (a later one): skipped, the rest read
        // (a 9.1 or 9.2 node skips arrays and timed values so)
        if (tag > static_cast<uint8_t>(ParamType::Array)) { pos = next; continue; }
        e.type = static_cast<ParamType>(tag);
        e.value.unknown = false;
        if (pos == next && e.type != ParamType::Trigger) {   // no value: unknown (9.1)
            e.value = ParamValue{};
            e.value.tag = e.type;
            e.value.unknown = true;
        } else if (!read_value(d, pos, next, e.type, e.value)) { pos = next; continue; }
        pos = next;   // a value that grew later: what this node reads of it
        ++decoded;
        fn(e, ctx);
    }
    return decoded;
}

size_t decode_stream_packet(etl::span<const uint8_t> data,
    uint32_t& sku_hash, uint32_t& time_ms,
    etl::span<DecodedStreamEntry> out, bool* refresh, bool* synced)
{
    struct Into { etl::span<DecodedStreamEntry> out; size_t n = 0; bool all_refresh = true; } into{out};
    read_stream_packet(data, sku_hash, time_ms, synced, [](const DecodedStreamEntry& e, void* ctx) {
        auto* i = static_cast<Into*>(ctx);
        if (i->n >= i->out.size()) return;
        i->out[i->n++] = e;
        i->all_refresh = i->all_refresh && e.refresh;
    }, &into);
    if (refresh) *refresh = into.n > 0 && into.all_refresh;
    return into.n;
}

} // namespace dataflou
