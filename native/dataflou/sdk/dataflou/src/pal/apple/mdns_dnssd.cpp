// mdns_dnssd.cpp — see mdns_dnssd.h.

#include "apple/mdns_dnssd.h"

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <sys/select.h>

#include <algorithm>
#include <chrono>
#include <cstring>

namespace dataflou {

namespace {

constexpr uint64_t kSweepMs = 5000;      // known peers are announced again this often
constexpr uint64_t kLookupTimeoutMs = 5000;
constexpr uint64_t kRetryMs = 2000;

uint64_t now_ms() {
    using namespace std::chrono;
    return static_cast<uint64_t>(
        duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

// "_dataflou._tcp.local." -> "_dataflou._tcp": Bonjour takes the type alone.
std::string regtype(const char* service_type) {
    std::string type = service_type ? service_type : "";
    for (const char* suffix : {".local.", ".local"}) {
        const size_t n = std::strlen(suffix);
        if (type.size() > n && type.compare(type.size() - n, n, suffix) == 0) {
            type.erase(type.size() - n);
            break;
        }
    }
    return type;
}

std::string txt_value(uint16_t len, const unsigned char* txt, const char* key) {
    uint8_t size = 0;
    const void* value = TXTRecordGetValuePtr(len, txt, key, &size);
    return value ? std::string(static_cast<const char*>(value), size) : std::string();
}

template <size_t N>
void assign(etl::string<N>& out, const std::string& in) {
    out.assign(in.c_str(), std::min(in.size(), static_cast<size_t>(out.max_size())));
}

} // namespace

MdnsDnssd::~MdnsDnssd() { close(); }

void MdnsDnssd::set_interface(const char* name) {
    interface_ = (name && *name) ? if_nametoindex(name) : 0;
    struct in_addr want{};
    if (interface_ || !name || inet_pton(AF_INET, name, &want) != 1) return;
    // An IPv4 address: the interface that has it
    struct ifaddrs* list = nullptr;
    if (getifaddrs(&list) != 0) return;
    for (struct ifaddrs* i = list; i && !interface_; i = i->ifa_next) {
        if (i->ifa_addr && i->ifa_addr->sa_family == AF_INET &&
            reinterpret_cast<const struct sockaddr_in*>(i->ifa_addr)->sin_addr.s_addr == want.s_addr)
            interface_ = if_nametoindex(i->ifa_name);
    }
    freeifaddrs(list);
}

void MdnsDnssd::fail(const char* what, DNSServiceErrorType error) {
    if (error == kDNSServiceErr_PolicyDenied) {
        status_ = "local network access denied";
    } else {
        status_ = std::string(what) + " failed (" + std::to_string(error) + ")";
    }
}

bool MdnsDnssd::connect() {
    if (main_) return true;
    const DNSServiceErrorType error = DNSServiceCreateConnection(&main_);
    if (error != kDNSServiceErr_NoError) {
        main_ = nullptr;
        fail("connecting to Bonjour", error);
        retry_at_ = now_ms() + kRetryMs;
        return false;
    }
    return true;
}

// Closing the shared connection ends every operation made on it.
void MdnsDnssd::close() {
    if (main_) DNSServiceRefDeallocate(main_);
    main_ = nullptr;
    for (Advert& advert : adverts_) advert.ref = nullptr;
    browse_ = nullptr;
    lookups_.clear();
}

void MdnsDnssd::advertise(const char* name, const char* service_type, uint16_t port,
                          const char* txt[], size_t txt_count) {
    const std::string advert_name = name ? name : "";
    const std::string type = regtype(service_type);
    Advert* advert = nullptr;
    for (Advert& a : adverts_)
        if (a.name == advert_name && a.type == type) advert = &a;
    if (!advert) {
        adverts_.emplace_back();
        advert = &adverts_.back();
        advert->name = advert_name;
        advert->type = type;
    }
    advert->port = port;
    advert->txt.clear();
    for (size_t i = 0; i < txt_count; ++i) advert->txt.emplace_back(txt[i]);
    start_advertise(*advert);
}

void MdnsDnssd::start_adverts() {
    for (Advert& advert : adverts_) start_advertise(advert);
}

// Registered anew, also to update it (its port, its TXT), as one
// registration was before there were several.
void MdnsDnssd::start_advertise(Advert& advert) {
    if (!connect()) return;
    if (advert.ref) {
        DNSServiceRefDeallocate(advert.ref);
        advert.ref = nullptr;
    }

    TXTRecordRef record;
    TXTRecordCreate(&record, 0, nullptr);
    for (const std::string& entry : advert.txt) {
        const size_t eq = entry.find('=');
        const std::string key = entry.substr(0, eq);
        const std::string value = eq == std::string::npos ? std::string() : entry.substr(eq + 1);
        TXTRecordSetValue(&record, key.c_str(), static_cast<uint8_t>(std::min<size_t>(value.size(), 255)),
                          value.data());
    }

    DNSServiceRef ref = main_;
    const DNSServiceErrorType error = DNSServiceRegister(
        &ref, kDNSServiceFlagsShareConnection, interface_, advert.name.c_str(),
        advert.type.c_str(), nullptr, nullptr, htons(advert.port),
        TXTRecordGetLength(&record), TXTRecordGetBytesPtr(&record), on_register, this);
    TXTRecordDeallocate(&record);
    if (error == kDNSServiceErr_NoError) advert.ref = ref;
    else fail("advertising", error);
}

void MdnsDnssd::browse(const char* service_type) {
    browse_type_ = regtype(service_type);
    start_browse();
}

void MdnsDnssd::start_browse() {
    if (browse_type_.empty() || !connect()) return;
    if (browse_) {
        DNSServiceRefDeallocate(browse_);
        browse_ = nullptr;
    }
    DNSServiceRef ref = main_;
    const DNSServiceErrorType error = DNSServiceBrowse(
        &ref, kDNSServiceFlagsShareConnection, interface_, browse_type_.c_str(), nullptr,
        on_browse, this);
    if (error == kDNSServiceErr_NoError) {
        browse_ = ref;
        status_ = "ok";
    } else {
        fail("browsing", error);
    }
}

void MdnsDnssd::stop() {
    close();
    adverts_.clear();
    browse_type_.clear();
    peers_.clear();
    events_.clear();
    status_ = "idle";
}

// The daemon dropped us: every peer is gone as far as we know. Start over.
void MdnsDnssd::restart() {
    close();
    for (const auto& [name, peer] : peers_) {
        if (peer.found) emit(MdnsEvent::PeerLost, peer);
    }
    peers_.clear();
    retry_at_ = now_ms() + kRetryMs;
}

MdnsDnssd::Lookup* MdnsDnssd::add_lookup(const std::string& name) {
    lookups_.push_back(std::make_unique<Lookup>());
    Lookup* lookup = lookups_.back().get();
    lookup->self = this;
    lookup->name = name;
    return lookup;
}

void MdnsDnssd::resolve(Peer& peer) {
    if (!main_) return;
    Lookup* lookup = add_lookup(peer.name);
    DNSServiceRef ref = main_;
    const DNSServiceErrorType error = DNSServiceResolve(
        &ref, kDNSServiceFlagsShareConnection, peer.interface, peer.name.c_str(),
        browse_type_.c_str(), "local.", on_resolve, lookup);
    if (error != kDNSServiceErr_NoError) {
        lookup->done = true;
        return;
    }
    lookup->ref = ref;
    peer.busy = true;
    peer.busy_since = now_ms();
}

// A resolve answers from the daemon's cache, which the new record's
// announcement updated, or waits for the node to register again (up to
// kLookupTimeoutMs). Once per loss or failed dial: no storm.
void MdnsDnssd::look_again(const char* sku) {
    if (!sku || !*sku) return;
    for (auto& [name, peer] : peers_)
        if (peer.sku == sku && !peer.busy) resolve(peer);
}

void MdnsDnssd::lookup_address(Peer& peer) {
    if (!main_) return;
    Lookup* lookup = add_lookup(peer.name);
    DNSServiceRef ref = main_;
    const DNSServiceErrorType error = DNSServiceGetAddrInfo(
        &ref, kDNSServiceFlagsShareConnection, peer.interface, kDNSServiceProtocol_IPv4,
        peer.host.c_str(), on_address, lookup);
    if (error != kDNSServiceErr_NoError) {
        lookup->done = true;
        peer.busy = false;
        return;
    }
    lookup->ref = ref;
    peer.busy = true;
    peer.busy_since = now_ms();
}

void MdnsDnssd::emit(MdnsEvent::Type type, const Peer& peer) {
    MdnsEvent event{};
    event.type = type;
    assign(event.name, peer.name);
    assign(event.address, peer.address);
    assign(event.sku, peer.sku);
    assign(event.universe, peer.universe);
    event.core_major = peer.core_major;
    assign(event.core_ver, peer.core_ver);
    event.role = peer.role;
    event.port = peer.port;
    events_.push_back(event);
}

void DNSSD_API MdnsDnssd::on_register(DNSServiceRef, DNSServiceFlags, DNSServiceErrorType error,
                                      const char*, const char*, const char*, void* context) {
    auto* self = static_cast<MdnsDnssd*>(context);
    if (error != kDNSServiceErr_NoError) self->fail("advertising", error);
}

void DNSSD_API MdnsDnssd::on_browse(DNSServiceRef, DNSServiceFlags flags, uint32_t interface,
                                    DNSServiceErrorType error, const char* name, const char*,
                                    const char*, void* context) {
    auto* self = static_cast<MdnsDnssd*>(context);
    if (error != kDNSServiceErr_NoError) {
        self->fail("browsing", error);
        return;
    }
    self->status_ = "ok";
    if (flags & kDNSServiceFlagsAdd) {
        Peer& peer = self->peers_[name];
        peer.name = name;
        peer.interface = interface;
        ++peer.seen;
        if (!peer.found && !peer.busy) self->resolve(peer);
    } else {
        auto it = self->peers_.find(name);
        if (it == self->peers_.end()) return;
        if (--it->second.seen > 0) return;   // still there on another interface
        if (it->second.found) self->emit(MdnsEvent::PeerLost, it->second);
        self->peers_.erase(it);
    }
}

void DNSSD_API MdnsDnssd::on_resolve(DNSServiceRef, DNSServiceFlags, uint32_t interface,
                                     DNSServiceErrorType error, const char*, const char* host,
                                     uint16_t port, uint16_t txt_len, const unsigned char* txt,
                                     void* context) {
    auto* lookup = static_cast<Lookup*>(context);
    MdnsDnssd* self = lookup->self;
    if (lookup->done) return;   // its first answer only
    lookup->done = true;
    auto it = self->peers_.find(lookup->name);
    if (it == self->peers_.end()) return;
    Peer& peer = it->second;
    peer.busy = false;
    if (error != kDNSServiceErr_NoError) return;
    peer.host = host;
    peer.port = ntohs(port);
    peer.interface = interface;
    // A node says sku=; a service of a node's (its OSCQuery, its page) says
    // node=, its node's sku, as the desktop backend reads it too
    peer.sku = txt_value(txt_len, txt, "sku");
    if (peer.sku.empty()) peer.sku = txt_value(txt_len, txt, "node");
    peer.universe = txt_value(txt_len, txt, "univ");
    const std::string core_ver = txt_value(txt_len, txt, "core_ver");
    peer.core_major = dataflou::core_major_of(core_ver.c_str(), core_ver.size());
    peer.core_ver = core_ver;
    const std::string role = txt_value(txt_len, txt, "role");
    peer.role = dataflou::role_of(role.c_str(), role.size());
    self->lookup_address(peer);
}

void DNSSD_API MdnsDnssd::on_address(DNSServiceRef, DNSServiceFlags flags, uint32_t,
                                     DNSServiceErrorType error, const char*,
                                     const struct sockaddr* address, uint32_t, void* context) {
    auto* lookup = static_cast<Lookup*>(context);
    MdnsDnssd* self = lookup->self;
    // Its first address only (one per interface may follow); one that goes
    // away is no answer
    if (lookup->done || (error == kDNSServiceErr_NoError && !(flags & kDNSServiceFlagsAdd))) return;
    lookup->done = true;
    auto it = self->peers_.find(lookup->name);
    if (it == self->peers_.end()) return;
    Peer& peer = it->second;
    peer.busy = false;
    if (error != kDNSServiceErr_NoError || !address || address->sa_family != AF_INET) return;
    char text[INET_ADDRSTRLEN] = {};
    const auto* in = reinterpret_cast<const struct sockaddr_in*>(address);
    if (!inet_ntop(AF_INET, &in->sin_addr, text, sizeof(text))) return;
    peer.address = text;
    peer.found = true;
    self->emit(MdnsEvent::PeerFound, peer);
}

// Take what the daemon has for us, without waiting.
void MdnsDnssd::process() {
    for (int i = 0; i < 64 && main_; ++i) {
        const int fd = DNSServiceRefSockFD(main_);
        if (fd < 0) break;
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(fd, &readable);
        struct timeval none = {0, 0};
        if (select(fd + 1, &readable, nullptr, nullptr, &none) <= 0) break;
        const DNSServiceErrorType error = DNSServiceProcessResult(main_);
        if (error != kDNSServiceErr_NoError) {
            fail("Bonjour", error);
            restart();
            return;
        }
    }
    // Finished lookups are closed here, not inside their own callback.
    for (auto& lookup : lookups_) {
        if (lookup->done && lookup->ref) {
            DNSServiceRefDeallocate(lookup->ref);
            lookup->ref = nullptr;
        }
    }
    lookups_.erase(std::remove_if(lookups_.begin(), lookups_.end(),
                                  [](const auto& lookup) { return lookup->done; }),
                   lookups_.end());
}

// Every few seconds: announce the known peers again (the core reconnects a
// dropped peer when it is found again, as with the desktop backend's
// periodic query), give up the lookups that never answered (a found peer's
// too: else look_again() would skip it for good), and retry the peers that
// never resolved.
void MdnsDnssd::sweep(uint64_t now) {
    for (auto& [name, peer] : peers_) {
        if (peer.busy && now > peer.busy_since && now - peer.busy_since > kLookupTimeoutMs) {
            for (auto& lookup : lookups_) {
                if (lookup->name == name) lookup->done = true;
            }
            peer.busy = false;
        }
        if (peer.found) {
            emit(MdnsEvent::PeerFound, peer);
        } else if (!peer.busy) {
            resolve(peer);
        }
    }
}

bool MdnsDnssd::poll_event(MdnsEvent& out) {
    const uint64_t now = now_ms();
    if (!main_ && (!adverts_.empty() || !browse_type_.empty()) && now >= retry_at_) {
        start_adverts();
        start_browse();
    }
    process();
    // After process(): a lookup it started is younger than this `now`, not
    // older (else, unsigned, it looked 2^64 ms old and was given up at once:
    // a node's first lookups, retried 5 s later)
    if (const uint64_t after = now_ms(); after >= next_sweep_) {
        next_sweep_ = after + kSweepMs;
        sweep(after);
    }
    if (events_.empty()) return false;
    out = events_.front();
    events_.pop_front();
    return true;
}

} // namespace dataflou
