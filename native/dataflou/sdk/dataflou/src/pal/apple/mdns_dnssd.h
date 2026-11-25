// mdns_dnssd.h — the core's IMdns on Apple's Bonjour (dns_sd.h).
//
// The desktop backend speaks mDNS itself on raw multicast sockets, which iOS
// only allows with a special entitlement. This one asks the system's Bonjour
// daemon instead: no entitlement, and it follows the local network permission.
//
// Like the rest of the core it never blocks and owns no thread: all work is
// done in poll_event(), on one connection to the daemon.
//
// Peers are resolved to IPv4 only. The core's sockets are IPv4, and a UDP
// packet sent to a peer's IPv6 address is lost without any error.
//
// It advertises as many services as it is given (the node's _dataflou._tcp,
// and a host's: dataflou-node's visualizer page, _http._tcp, and OSCQuery),
// one registration each; advertising a name and type again updates it. It
// browses one service type: the node's, or another for a host (the OSCQuery
// client's _oscjson._tcp, on an instance of its own).
#pragma once

#include "dataflou/pal.h"

#include <dns_sd.h>

#include <deque>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace dataflou {

class MdnsDnssd : public IMdns {
public:
    MdnsDnssd() = default;
    ~MdnsDnssd() override;
    bool reports_lost() const override { return true; }   // Bonjour says when a node goes
    // Resolve it again: a node that restarted at once under its name, on
    // another port, makes no browse event, and the sweep would go on giving
    // the old port.
    void look_again(const char* sku) override;

    // Limit browsing and advertising to one interface, by name ("en0") or by
    // one of its IPv4 addresses; "" for all.
    void set_interface(const char* name);

    void advertise(const char* name, const char* service_type, uint16_t port,
                   const char* txt[], size_t txt_count) override;
    void browse(const char* service_type) override;
    bool poll_event(MdnsEvent& out) override;
    void stop() override;

    // "ok", or what is wrong ("local network access denied", ...).
    const char* status() const { return status_.c_str(); }

private:
    struct Peer {
        std::string name;
        std::string host;
        std::string address;
        std::string sku;
        std::string universe;
        uint8_t     core_major = 0;   // from TXT "core_ver"
        std::string core_ver;
        dataflou::NodeRole role = dataflou::NodeRole::Full;   // from TXT "role"
        uint16_t port = 0;
        uint32_t interface = 0;   // where it was last seen
        int      seen = 0;        // interfaces it is currently seen on
        bool     found = false;   // has an address: PeerFound was sent
        bool     busy = false;    // a resolve or address lookup is under way
        uint64_t busy_since = 0;
    };
    // One service advertised, under its own registration.
    struct Advert {
        std::string   name;
        std::string   type;        // as Bonjour takes it: "_dataflou._tcp"
        uint16_t      port = 0;
        std::vector<std::string> txt;
        DNSServiceRef ref = nullptr;
    };
    // One resolve or address lookup; the daemon calls back with `this`.
    struct Lookup {
        MdnsDnssd*    self = nullptr;
        DNSServiceRef ref = nullptr;
        std::string   name;
        bool          done = false;
    };

    bool connect();
    void close();
    void restart();
    void start_advertise(Advert& advert);
    void start_adverts();
    void start_browse();
    void resolve(Peer& peer);
    void lookup_address(Peer& peer);
    void process();
    void sweep(uint64_t now);
    void emit(MdnsEvent::Type type, const Peer& peer);
    void fail(const char* what, DNSServiceErrorType error);
    Lookup* add_lookup(const std::string& name);

    static void DNSSD_API on_register(DNSServiceRef, DNSServiceFlags, DNSServiceErrorType,
                                      const char*, const char*, const char*, void*);
    static void DNSSD_API on_browse(DNSServiceRef, DNSServiceFlags, uint32_t, DNSServiceErrorType,
                                    const char*, const char*, const char*, void*);
    static void DNSSD_API on_resolve(DNSServiceRef, DNSServiceFlags, uint32_t, DNSServiceErrorType,
                                     const char*, const char*, uint16_t, uint16_t,
                                     const unsigned char*, void*);
    static void DNSSD_API on_address(DNSServiceRef, DNSServiceFlags, uint32_t, DNSServiceErrorType,
                                     const char*, const struct sockaddr*, uint32_t, void*);

    DNSServiceRef main_ = nullptr;      // the connection every operation shares
    DNSServiceRef browse_ = nullptr;
    std::vector<std::unique_ptr<Lookup>> lookups_;
    std::map<std::string, Peer> peers_; // by instance name
    std::deque<MdnsEvent> events_;

    // What to advertise and browse, kept to start again after the daemon
    // drops the connection (the app was suspended, the network changed).
    std::vector<Advert> adverts_;
    std::string browse_type_;

    uint32_t    interface_ = 0;
    std::string status_ = "idle";
    uint64_t    next_sweep_ = 0;
    uint64_t    retry_at_ = 0;
};

} // namespace dataflou
