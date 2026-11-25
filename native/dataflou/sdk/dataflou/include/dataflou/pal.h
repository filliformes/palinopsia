// pal.h — Platform Abstraction Layer interfaces.
//
// Five pure-virtual interfaces that the core library calls for I/O.
// Desktop builds use ASIO/file-based implementations; embedded builds
// use lwIP/flash-based implementations.
//
// Interfaces: ITcp, IUdp, IMdns, IClock, IStorage.
#pragma once

#include "dataflou/types.h"
#include <etl/string.h>
#include <etl/span.h>
#include <cstdint>

namespace dataflou {

// --- TCP ---

using SocketHandle = int; // opaque, -1 = invalid

constexpr SocketHandle INVALID_SOCKET_HANDLE = -1;

class ITcp {
public:
    // Bind + listen on a port. port=0 for ephemeral (OS-assigned).
    // Returns the listener handle, or INVALID_SOCKET_HANDLE on failure.
    virtual SocketHandle listen(uint16_t port) = 0;

    // Returns the actual port a listener is bound to (after ephemeral bind).
    virtual uint16_t local_port(SocketHandle listener) = 0;

    // Non-blocking accept. Returns INVALID_SOCKET_HANDLE if no pending connection.
    virtual SocketHandle accept(SocketHandle listener) = 0;

    // Non-blocking connect. Returns a handle immediately; use is_connected() to poll.
    virtual SocketHandle connect(const char* addr, uint16_t port) = 0;

    // Non-blocking send. Returns bytes sent, 0 if would block, -1 on error.
    virtual int send(SocketHandle s, etl::span<const uint8_t> data) = 0;

    // Non-blocking recv. Returns bytes received, 0 if would block, -1 on error.
    virtual int recv(SocketHandle s, etl::span<uint8_t> buf) = 0;

    virtual bool is_connected(SocketHandle s) = 0;
    virtual void close(SocketHandle s) = 0;

    // Write the remote peer's IP address (e.g. "192.168.1.10") into out_addr.
    // Returns true on success. Returns false if the socket is invalid or the
    // address cannot be determined (e.g. listener handle).
    virtual bool remote_addr(SocketHandle s, char* out_addr, size_t addr_max) = 0;

    // How many peer connections the transport can hold at once, the listener
    // aside; 0: no limit known (an OS). A W5500 has 8 sockets in all.
    virtual size_t connection_limit() const { return 0; }

    virtual ~ITcp() = default;
};

// --- mDNS ---

struct MdnsEvent {
    enum Type : uint8_t { PeerFound, PeerLost };
    Type type;
    etl::string<64> name;
    etl::string<46> address; // IPv4 or IPv6 string
    uint16_t port = 0;
    etl::string<36> sku;
    etl::string<32> universe;
    uint8_t core_major = 0;  // from TXT "core_ver=9.0" (0: not said)
    etl::string<12> core_ver; // the whole of it ("9.0"), when said
    NodeRole role = NodeRole::Full;   // from TXT "role=satellite" (9.0; absent: full)
};

// A "role" TXT value ("satellite", "source"; anything else: full).
inline NodeRole role_of(const char* v, size_t n) {
    if (n == 9 && memcmp(v, "satellite", 9) == 0) return NodeRole::Satellite;
    if (n == 6 && memcmp(v, "source", 6) == 0) return NodeRole::Source;
    return NodeRole::Full;
}

// The major of a "core_ver" TXT value ("9.0" -> 9; 0 if unreadable).
inline uint8_t core_major_of(const char* v, size_t n) {
    unsigned m = 0;
    size_t i = 0;
    for (; i < n && v[i] >= '0' && v[i] <= '9'; ++i) m = m * 10 + unsigned(v[i] - '0');
    return (i > 0 && m < 256) ? static_cast<uint8_t>(m) : 0;
}

// Whether a peer whose mDNS record says this core version ("9.1") speaks
// this node's wire format. The format changes with the major, and once
// within one: 9.0 is apart from 9.1 and later 9.x. Unreadable: assumed
// (HELLO checks anyway).
inline bool same_wire_format(const char* v, size_t n, uint8_t my_major, uint8_t my_minor) {
    const uint8_t major = core_major_of(v, n);
    if (major == 0) return true;
    if (major != my_major) return false;
    if (major != 9) return true;
    size_t i = 0;
    while (i < n && v[i] != '.') ++i;
    unsigned minor = 0;
    for (++i; i < n && v[i] >= '0' && v[i] <= '9'; ++i) minor = minor * 10 + unsigned(v[i] - '0');
    return (minor == 0) == (my_minor == 0);
}

class IMdns {
public:
    virtual void advertise(const char* name, const char* service_type,
                           uint16_t port,
                           const char* txt[], size_t txt_count) = 0;
    virtual void browse(const char* service_type) = 0;
    virtual bool poll_event(MdnsEvent& out) = 0;
    virtual void stop() = 0;
    // Whether a node's leaving comes as PeerLost (Bonjour); else what is
    // there is heard again and again (a backend that asks every 15 s), and
    // what isn't heard of for a while is gone
    virtual bool reports_lost() const { return false; }
    // The core lost the link to a node this backend reported, or could not
    // reach it where it said: what it holds of that node may be stale (a
    // node that restarted at once under the same name, on another port). A
    // backend that keeps what it resolved (Bonjour) looks it up again; one
    // that asks the network again and again has nothing to do.
    virtual void look_again(const char* sku) { (void)sku; }
    virtual ~IMdns() = default;
};

// --- UDP ---

using UdpHandle = int;
constexpr UdpHandle INVALID_UDP_HANDLE = -1;

class IUdp {
public:
    virtual UdpHandle bind(uint16_t port) = 0;
    virtual uint16_t  local_port(UdpHandle h) = 0;
    virtual int       send_to(UdpHandle h, etl::span<const uint8_t> data,
                              const char* addr, uint16_t port) = 0;
    virtual int       recv_from(UdpHandle h, etl::span<uint8_t> buf,
                                char* out_addr, size_t addr_max, uint16_t& out_port) = 0;
    virtual void      close(UdpHandle h) = 0;
    virtual ~IUdp() = default;
};

// --- Clock ---

class IClock {
public:
    virtual uint64_t millis() = 0;
    virtual ~IClock() = default;
};

// --- Storage (persistence) ---

class IStorage {
public:
    virtual bool write(const char* key, etl::span<const uint8_t> data) = 0;
    virtual bool read(const char* key, etl::span<uint8_t> buf, size_t& out_len) = 0;
    virtual ~IStorage() = default;
};

} // namespace dataflou
