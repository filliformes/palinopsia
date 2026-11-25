#pragma once

#include "dataflou/pal.h"

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace dataflou {

class MdnsDesktop : public IMdns {
public:
    MdnsDesktop();
    ~MdnsDesktop();

    void advertise(const char* name, const char* service_type,
                   uint16_t port,
                   const char* txt[], size_t txt_count) override;

    void browse(const char* service_type) override;

    bool poll_event(MdnsEvent& out) override;

    void stop() override;

    // Run on one network interface, given by its IPv4 address: mDNS joins
    // the group and sends there only, and every answer carries that address.
    // Without one, it sends from the primary address and listens on every
    // interface. Call before advertise() / browse(). Not part of the IMdns
    // contract.
    void set_interface(const char* ipv4) { iface_ = ipv4 ? ipv4 : ""; }

    // IPv4 address of an interface given by address (as is), by name (en0,
    // eth0) or by a glob over names and addresses (en*, 192.168.*), among the
    // interfaces that are up; names and globs are POSIX only. `chosen` gets
    // the interface's name. Empty if none.
    static std::string interface_ipv4(const char* iface, std::string* chosen = nullptr);

    // ------------------------------------------------------------------
    // The types and method below are public so that the C-linkage mDNS
    // callback (defined in the .cpp file) can populate them via the
    // opaque user_data pointer.  They are not part of the IMdns contract.
    // ------------------------------------------------------------------

    struct PendingPeer {
        std::string instance_name;   // from PTR
        std::string hostname;        // from SRV
        std::string address;         // from A or AAAA
        uint16_t    port = 0;        // from SRV
        std::string sku;             // from TXT "sku=..."
        std::string universe;        // from TXT "univ=..."
        uint8_t     core_major = 0;  // from TXT "core_ver=..."
        std::string core_ver;
        dataflou::NodeRole role = dataflou::NodeRole::Full;   // from TXT "role=..."
        bool has_srv     = false;
        bool has_address = false;
    };

    std::vector<PendingPeer> pending_;

    // A / AAAA records of the packet being parsed, matched to the pending
    // peers by SRV target in flush_pending().
    struct PendingAddr {
        std::string hostname;        // record owner name
        std::string address;
        bool        v6 = false;
    };
    std::vector<PendingAddr> pending_addrs_;

    // Pending peer whose instance name matches `name` (SRV / TXT owner),
    // else the last one created by a PTR, unless `name` is an instance of
    // another service type.
    PendingPeer* pending_for(const char* name, size_t len);

    // `type` is the service type browsed (_dataflou._tcp.local.).
    bool browsing(const char* type, size_t len) const;

    // Helper: convert sockaddr to human-readable address string.
    static void sockaddr_to_string(const struct sockaddr* addr, size_t addrlen,
                                   char* buf, size_t buf_capacity);

    // Called by the C-linkage callback to answer incoming mDNS queries.
    void handle_question(int sock, const struct sockaddr* from, size_t addrlen,
                         uint16_t query_id, uint16_t rtype, uint16_t rclass,
                         const void* data, size_t size, size_t name_offset);

    struct Service {
        std::string name;            // e.g. "MyNode"
        std::string type;            // e.g. "_dataflou._tcp.local."
        uint16_t    port = 0;
        std::vector<std::string> txt_kv;   // "key=value" strings
        std::vector<std::pair<std::string, std::string>> txt_parsed;
        std::string qualified_name;  // "MyNode._dataflou._tcp.local."
    };

private:
    void flush_pending();            // move completed PendingPeers into event queue

    // Interface chosen with set_interface() (empty: all).
    std::string iface_;
    uint32_t    send_addr_ = 0;      // outgoing multicast interface (0: INADDR_ANY)
    void pin_send_if(bool force);    // follow send_ipv4() on both sockets

    // Service advertisement state ------------------------------------------
    int         service_sock_ = -1;  // socket bound to MDNS_PORT (5353)
    std::vector<Service> services_;
    std::string hostname_local_;     // "mymachine.local."

    void send_announcement(const Service& svc);  // send multicast announcement for one service

    // Browse / query state -------------------------------------------------
    int         query_sock_ = -1;    // ephemeral-port socket for queries
    int         query_id_   = 0;
    std::string browse_type_;

    // Keeping discovery alive ------------------------------------------------
    // Announcements and the browse query used to go out once, at start, and
    // the multicast group was joined once, on the interface the kernel picked
    // then. A node that left the network and came back (Wi-Fi drop, sleep,
    // cable unplugged longer than the 30 s peer timeout) was never heard
    // again: its peers marked it offline and nothing asked for it any more,
    // so its streams stayed dead until someone restarted a node.
    void    refresh();               // from poll_event(), rate-limited
    void    join_multicast_groups(); // (re)join 224.0.0.251 on each IPv4 interface
    void    send_refresh_query();    // QM query from port 5353, on each interface
    int64_t  next_refresh_ms_ = 0;
    int64_t  next_query_ms_   = 0;
    uint32_t route_addr_      = 0;   // our source address towards 224.0.0.251

    // Buffers (reused across poll calls) -----------------------------------
    static constexpr size_t kBufSize = 2048;
    alignas(4) uint8_t buffer_[kBufSize]{};
    alignas(4) uint8_t answer_buf_[kBufSize]{};  // separate buffer for query responses

    // Queued events ready for consumption ----------------------------------
    std::vector<MdnsEvent> events_;
};

} // namespace dataflou
