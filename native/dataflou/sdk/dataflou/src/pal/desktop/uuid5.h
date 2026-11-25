/// uuid5.h — Name-based UUIDs (RFC 9562 version 5, SHA-1), and random ones
/// (version 4).
///
/// A node's sku is random (random_v4), drawn the first time a name is used on
/// a machine and stored there: the same name on two computers is two nodes.
/// from_name() gives stable file names for a node name.

#pragma once

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <random>
#include <string>

namespace dataflou_uuid5 {

// Fixed namespace for dataflou node names. Never change it: every sku derived
// from a name depends on it.
inline constexpr uint8_t kNodeNamespace[16] = {
    0xb1, 0x56, 0x54, 0x3b, 0x36, 0x8a, 0x49, 0xf4,
    0x99, 0xd8, 0x45, 0x22, 0x44, 0x24, 0x77, 0x89,
}; // b156543b-368a-49f4-99d8-452244247789

inline void sha1(const uint8_t* data, size_t len, uint8_t out[20]) {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    auto rol = [](uint32_t x, int n) { return (x << n) | (x >> (32 - n)); };

    // Message plus 0x80, zero padding and the 64-bit bit length, in 64-byte blocks.
    const size_t total = ((len + 8) / 64 + 1) * 64;
    std::string msg(reinterpret_cast<const char*>(data), len);
    msg.resize(total, '\0');
    msg[len] = static_cast<char>(0x80);
    const uint64_t bits = static_cast<uint64_t>(len) * 8;
    for (int i = 0; i < 8; ++i)
        msg[total - 1 - i] = static_cast<char>(bits >> (8 * i));

    for (size_t off = 0; off < total; off += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i) {
            const auto* p = reinterpret_cast<const uint8_t*>(msg.data() + off + i * 4);
            w[i] = (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | p[3];
        }
        for (int i = 16; i < 80; ++i)
            w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20)      { f = (b & c) | (~b & d);          k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d;                   k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                   k = 0xCA62C1D6; }
            const uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    for (int i = 0; i < 5; ++i)
        for (int j = 0; j < 4; ++j)
            out[i * 4 + j] = static_cast<uint8_t>(h[i] >> (24 - 8 * j));
}

// Lowercase 8-4-4-4-12 form, like the skus in the config files.
inline std::string format(const uint8_t b[16]) {
    char buf[37];
    std::snprintf(buf, sizeof(buf),
        "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
    return buf;
}

inline std::string from_name(const std::string& name, const uint8_t ns[16] = kNodeNamespace) {
    std::string input(reinterpret_cast<const char*>(ns), 16);
    input += name;
    uint8_t hash[20];
    sha1(reinterpret_cast<const uint8_t*>(input.data()), input.size(), hash);
    hash[6] = static_cast<uint8_t>((hash[6] & 0x0F) | 0x50); // version 5
    hash[8] = static_cast<uint8_t>((hash[8] & 0x3F) | 0x80); // RFC variant
    return format(hash);
}

inline std::string random_v4() {
    std::random_device rd;
    uint8_t b[16];
    for (int i = 0; i < 16; i += 4) {
        const uint32_t r = rd();
        for (int j = 0; j < 4; ++j) b[i + j] = static_cast<uint8_t>(r >> (8 * j));
    }
    b[6] = static_cast<uint8_t>((b[6] & 0x0F) | 0x40); // version 4
    b[8] = static_cast<uint8_t>((b[8] & 0x3F) | 0x80); // RFC variant
    return format(b);
}

} // namespace dataflou_uuid5
