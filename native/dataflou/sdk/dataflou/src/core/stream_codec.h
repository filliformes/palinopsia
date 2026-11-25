// stream_codec.h — Compact binary codec for the UDP data plane.
//
// Unlike the TCP control plane (CBOR in protocol.h), the data plane uses a
// minimal binary format optimised for low-latency streaming of parameter
// values between nodes. One packet = one or more param entries.
#pragma once

#include "dataflou/types.h"
#include <etl/span.h>
#include <cstdint>
#include <cstddef>

namespace dataflou {

// Stream packet format 4 (core 9.1; compact binary, not CBOR):
//
// Header (16 bytes):
//   [1] 0xDF, [1] format (4)
//   [1] flags: bit 1 the time is the mesh's (the source's clock is synced)
//   [1] reserved (0)
//   [4] sku_hash: CRC32 of the source's SKU
//   [4] time: the mesh's clock (ms, lower 32 bits) when the packet left
//   [2] entry count
//   [2] reserved (0)
//
// Per entry:
//   [2] stream id: the source's number for this stream (1 … 0x7FFF); bit 15
//       set: the path follows (a stream's first packets, and every refresh)
//   [2] seq: the stream's packet count (wraps): loss and late packets
//   ([1] path_len, [N] path) when bit 15 is set
//   [1] type_tag (ParamType); bit 7: a refresh (the source resends a value
//       it already sent, against UDP loss; a receiver applies it only if it
//       differs). One packet carries what goes to one destination in one
//       tick, refreshes and changes together.
//   [2] the value's length, so an entry of a kind the receiver doesn't
//       know is skipped and the rest of the packet still read (format 4:
//       later kinds of entry stay compatible)
//   [V] value: Bool 1, Number 8 (double), V2 8, V3 12, V4 16 (floats),
//       Colour 4, String / Blob [2] len + data; Trigger 0. None (length 0)
//       for another type: the value is unknown (null).
//       Array (9.3): [1] element type (ElemType in its 5 low bits; for
//       bools, the 3 high bits: unused bits of the last byte), then the
//       elements: float / int 4 bytes, colour 4, byte 1, bool 1 bit (bit 0
//       first). The length says how many. A node before 9.3 skips the entry.
//       Timed (9.3, kind 10, STREAM_KIND_TIMED): a value that carries the
//       mesh time it is true at. [4] signed offset (ms) from the header's
//       time, [1] the value's type tag, then the value as its kind writes
//       it (the entry's length covers it all). A node before 9.3 skips the
//       entry; a source sends one only to a peer that says "timed".
//   (integers and floats LE)

static constexpr uint8_t  STREAM_MAGIC        = 0xDF;
static constexpr uint8_t  STREAM_FORMAT       = 4;
static constexpr uint8_t  STREAM_ENTRY_REFRESH = 0x80;   // in the type byte
static constexpr uint8_t  STREAM_FLAG_SYNCED  = 0x02;
static constexpr size_t   STREAM_HEADER_SIZE  = 16;
static constexpr uint16_t STREAM_ID_NAMED     = 0x8000;
static constexpr uint16_t STREAM_ID_MAX       = 0x7FFF;
static constexpr uint8_t  STREAM_KIND_TIMED   = 10;     // a value with its time (9.3)

struct StreamEntry {
    uint16_t    id = 0;
    uint16_t    seq = 0;
    const char* path = nullptr;   // sent when not null
    ParamType   type = ParamType::Number;
    ParamValue  value;
    bool        refresh = false;
    uint64_t    at = 0;           // 9.3: the mesh time it is true at (0: not stamped)
};

struct DecodedStreamEntry {
    uint16_t    id = 0;
    uint16_t    seq = 0;
    const char* path = nullptr;   // into the packet, not terminated; null if not sent
    uint8_t     path_len = 0;
    ParamType   type = ParamType::Number;
    ParamValue  value;
    bool        refresh = false;
    bool        timed = false;    // 9.3: it carries its time,
    int32_t     offset = 0;       // that many ms after the header's time
};

// The bytes an entry takes in a packet
size_t stream_entry_size(const StreamEntry& e);

// An array's value as the stream carries it (its element type, then its
// elements; SETVAL carries the same bytes): its size, written at p (room
// for array_wire_size), read from len bytes (false: not one this node reads)
size_t array_wire_size(const ParamValue& v);
void   write_array(uint8_t* p, const ParamValue& v);
bool   read_array(const uint8_t* d, size_t len, ParamValue& v);

// Encode entries into a stream packet (`refresh`: every entry is one).
// Returns bytes written, or 0 on error/overflow.
size_t encode_stream_packet(etl::span<uint8_t> buf,
    uint32_t sku_hash, uint32_t time_ms,
    etl::span<const StreamEntry> entries, bool refresh = false, bool synced = false);

// Each entry of a stream packet as it is read, however many: fn(entry, ctx).
// Returns the number read, 0 if it isn't a packet (or of another format).
using StreamEntryFn = void (*)(const DecodedStreamEntry& e, void* ctx);
size_t read_stream_packet(etl::span<const uint8_t> data,
    uint32_t& sku_hash, uint32_t& time_ms, bool* synced, StreamEntryFn fn, void* ctx);

// Decode a stream packet into `out` (up to its size). Returns the number of
// entries decoded, or 0 on error (another format included). Paths point into
// `data`. `refresh`: every entry decoded is one.
size_t decode_stream_packet(etl::span<const uint8_t> data,
    uint32_t& sku_hash, uint32_t& time_ms,
    etl::span<DecodedStreamEntry> out, bool* refresh = nullptr, bool* synced = nullptr);

} // namespace dataflou
