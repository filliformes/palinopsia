// Pull in the implementation of the mjansson single-header mdns library.
// MDNS_IMPLEMENTATION must be defined in exactly one translation unit.
#define MDNS_IMPLEMENTATION
#include <mdns.h>

#include "desktop/mdns_mjansson.h"

#include <algorithm>
#include <chrono>
#include <cstring>

#ifdef _WIN32
#include <Winsock2.h>
#include <Ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <fnmatch.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

// ---------------------------------------------------------------------------
// C-linkage callback matching mdns_record_callback_fn exactly.
// Declared outside the dataflou namespace so it has C-compatible linkage and
// the enum type mdns_entry_type_t is used directly.
// ---------------------------------------------------------------------------

static int mdns_desktop_callback(int sock, const struct sockaddr* from,
                                 size_t addrlen, mdns_entry_type_t entry,
                                 uint16_t query_id, uint16_t rtype,
                                 uint16_t rclass, uint32_t /*ttl*/,
                                 const void* data, size_t size,
                                 size_t name_offset, size_t /*name_length*/,
                                 size_t record_offset, size_t record_length,
                                 void* user_data) {
    auto* self = static_cast<dataflou::MdnsDesktop*>(user_data);

    // Respond to incoming queries so other nodes can discover us.
    if (entry == MDNS_ENTRYTYPE_QUESTION) {
        self->handle_question(sock, from, addrlen, query_id, rtype, rclass,
                              data, size, name_offset);
        return 0;
    }

    // We are interested in answer and additional records for discovery.
    if (entry != MDNS_ENTRYTYPE_ANSWER && entry != MDNS_ENTRYTYPE_ADDITIONAL) {
        return 0;
    }

    char name_buf[256]{};
    char str_buf[256]{};

    // The record's own name: the instance for SRV/TXT, the host for A/AAAA.
    // Records are matched by name, not by position in the packet, so a packet
    // carrying several services (or records in any order) is parsed right.
    char owner_buf[256]{};
    size_t owner_off = name_offset;
    mdns_string_t owner = mdns_string_extract(data, size, &owner_off,
                                              owner_buf, sizeof(owner_buf));

    switch (rtype) {
    case MDNS_RECORDTYPE_PTR: {
        // PTR record: discover a new service instance, of the type we browse
        // only. Responders answer with all their services: a node's web
        // visualizer (_http._tcp) is not a peer, even with sku= in its TXT.
        if (!self->browsing(owner.str, owner.length)) break;
        mdns_string_t namestr = mdns_record_parse_ptr(data, size, record_offset,
                                                      record_length, str_buf,
                                                      sizeof(str_buf));
        dataflou::MdnsDesktop::PendingPeer peer;
        peer.instance_name.assign(namestr.str, namestr.length);

        // Extract the sender address as a fallback.
        dataflou::MdnsDesktop::sockaddr_to_string(from, addrlen,
                                                   name_buf, sizeof(name_buf));
        peer.address.assign(name_buf);

        self->pending_.push_back(std::move(peer));
        break;
    }

    case MDNS_RECORDTYPE_SRV: {
        // SRV record: contains port and hostname.
        mdns_record_srv_t srv = mdns_record_parse_srv(data, size, record_offset,
                                                      record_length, str_buf,
                                                      sizeof(str_buf));
        if (auto* peer = self->pending_for(owner.str, owner.length)) {
            peer->port = srv.port;
            peer->hostname.assign(srv.name.str, srv.name.length);
            peer->has_srv = true;
        }
        break;
    }

    case MDNS_RECORDTYPE_A: {
        // A record: IPv4 address.
        struct sockaddr_in addr{};
        mdns_record_parse_a(data, size, record_offset, record_length, &addr);

        char addr_buf[INET_ADDRSTRLEN]{};
        inet_ntop(AF_INET, &addr.sin_addr, addr_buf, sizeof(addr_buf));

        // Resolved against the SRV target in flush_pending().
        self->pending_addrs_.push_back({std::string(owner.str, owner.length),
                                        std::string(addr_buf), false});
        break;
    }

    case MDNS_RECORDTYPE_AAAA: {
        // AAAA record: IPv6 address.
        struct sockaddr_in6 addr6{};
        mdns_record_parse_aaaa(data, size, record_offset, record_length, &addr6);

        char addr_buf[INET6_ADDRSTRLEN]{};
        inet_ntop(AF_INET6, &addr6.sin6_addr, addr_buf, sizeof(addr_buf));

        // Resolved against the SRV target in flush_pending() (IPv4 preferred).
        self->pending_addrs_.push_back({std::string(owner.str, owner.length),
                                        std::string(addr_buf), true});
        break;
    }

    case MDNS_RECORDTYPE_TXT: {
        // TXT record: parse key=value pairs.  We look for "sku=..." (a
        // node), or "node=..." (a node's web visualizer: its node's sku).
        mdns_record_txt_t txt_records[16]{};
        size_t parsed = mdns_record_parse_txt(data, size, record_offset,
                                              record_length, txt_records, 16);

        if (auto* peer = self->pending_for(owner.str, owner.length)) {
            for (size_t i = 0; i < parsed; ++i) {
                if ((txt_records[i].key.length == 3 &&
                     std::strncmp(txt_records[i].key.str, "sku", 3) == 0) ||
                    (txt_records[i].key.length == 4 &&
                     std::strncmp(txt_records[i].key.str, "node", 4) == 0)) {
                    peer->sku.assign(txt_records[i].value.str,
                                     txt_records[i].value.length);
                }
                if (txt_records[i].key.length == 4 &&
                    std::strncmp(txt_records[i].key.str, "univ", 4) == 0) {
                    peer->universe.assign(txt_records[i].value.str,
                                          txt_records[i].value.length);
                }
                if (txt_records[i].key.length == 8 &&
                    std::strncmp(txt_records[i].key.str, "core_ver", 8) == 0) {
                    peer->core_major = dataflou::core_major_of(txt_records[i].value.str,
                                                     txt_records[i].value.length);
                    peer->core_ver.assign(txt_records[i].value.str,
                                          std::min<size_t>(txt_records[i].value.length, 11));
                }
                if (txt_records[i].key.length == 4 &&
                    std::strncmp(txt_records[i].key.str, "role", 4) == 0) {
                    peer->role = dataflou::role_of(txt_records[i].value.str,
                                                   txt_records[i].value.length);
                }
            }
        }
        break;
    }

    default:
        break;
    }

    return 0; // continue parsing
}

// ---------------------------------------------------------------------------

namespace dataflou {

// ---------------------------------------------------------------------------
// DNS names and our IPv4 address
// ---------------------------------------------------------------------------

// Case-insensitive DNS name comparison, ignoring a trailing dot.
static bool dns_name_equal(const char* a, size_t alen, const char* b, size_t blen) {
    while (alen > 0 && a[alen - 1] == '.') --alen;
    while (blen > 0 && b[blen - 1] == '.') --blen;
    if (alen != blen) return false;
    for (size_t i = 0; i < alen; ++i) {
        char ca = a[i], cb = b[i];
        if (ca >= 'A' && ca <= 'Z') ca = static_cast<char>(ca - 'A' + 'a');
        if (cb >= 'A' && cb <= 'Z') cb = static_cast<char>(cb - 'A' + 'a');
        if (ca != cb) return false;
    }
    return true;
}

static bool dns_name_equal(const std::string& a, const std::string& b) {
    return dns_name_equal(a.c_str(), a.size(), b.c_str(), b.size());
}

// Not unspecified, loopback or link-local.
static bool usable_ipv4(const struct in_addr& a) {
    const uint32_t ip = ntohl(a.s_addr);
    return ip != 0 && (ip >> 24) != 127 && (ip >> 16) != 0xA9FE;
}

// Source address the OS would use towards `dst`: a UDP connect() does the
// route lookup and sends nothing.
static bool route_source_ipv4(const struct sockaddr_in& dst, struct in_addr& out) {
#ifdef _WIN32
    SOCKET s = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) return false;
#else
    int s = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s < 0) return false;
#endif
    bool ok = false;
    if (::connect(s, reinterpret_cast<const struct sockaddr*>(&dst), sizeof(dst)) == 0) {
        struct sockaddr_in local{};
        socklen_t len = sizeof(local);
        if (::getsockname(s, reinterpret_cast<struct sockaddr*>(&local), &len) == 0) {
            out = local.sin_addr;
            ok = true;
        }
    }
#ifdef _WIN32
    ::closesocket(s);
#else
    ::close(s);
#endif
    return ok;
}

static bool route_source_ipv4(const char* ip, uint16_t port, struct in_addr& out) {
    struct sockaddr_in dst{};
    dst.sin_family = AF_INET;
    dst.sin_port = htons(port);
    if (::inet_pton(AF_INET, ip, &dst.sin_addr) != 1) return false;
    return route_source_ipv4(dst, out);
}

// The address we advertise: the default route's source, else the mDNS
// route's (an offline installation LAN), never loopback / link-local, else
// the first usable address of this host. A route lookup for 224.0.0.251 can
// return 127.0.0.1 on Windows, hence the default route first.
static bool primary_ipv4(struct in_addr& out) {
    if (route_source_ipv4("8.8.8.8", 53, out) && usable_ipv4(out)) return true;
    if (route_source_ipv4("224.0.0.251", MDNS_PORT, out) && usable_ipv4(out)) return true;

    char hostname_buf[256]{};
    ::gethostname(hostname_buf, sizeof(hostname_buf));
    struct addrinfo hints{}, *res = nullptr;
    hints.ai_family = AF_INET;
    bool ok = false;
    if (::getaddrinfo(hostname_buf, nullptr, &hints, &res) == 0 && res) {
        for (struct addrinfo* r = res; r; r = r->ai_next) {
            const auto* sa = reinterpret_cast<const struct sockaddr_in*>(r->ai_addr);
            if (usable_ipv4(sa->sin_addr)) {
                out = sa->sin_addr;
                ok = true;
                break;
            }
        }
        ::freeaddrinfo(res);
    }
    return ok;
}

// The address to put in an answer sent to `from` (nullptr: multicast). A
// remote querier gets our address on its own network (multi-homed hosts:
// venue Wi-Fi + wired sensor LAN); a querier on this machine, or a multicast
// answer, gets the primary address. Each peer therefore always sees the same
// address, which the core relies on (it reconnects when a peer's port moves).
static bool answer_ipv4(const struct sockaddr* from, struct sockaddr_in& out) {
    out = sockaddr_in{};
    out.sin_family = AF_INET;
    if (from && from->sa_family == AF_INET) {
        const auto* q = reinterpret_cast<const struct sockaddr_in*>(from);
        struct in_addr via{};
        if (usable_ipv4(q->sin_addr) && route_source_ipv4(*q, via) &&
            usable_ipv4(via) && via.s_addr != q->sin_addr.s_addr) {
            out.sin_addr = via; // remote querier: our address towards it
            return true;
        }
    }
    return primary_ipv4(out.sin_addr);
}

// On a chosen interface (`iface`, its IPv4 address), every answer carries
// that address; otherwise answer_ipv4() picks it.
static bool answer_addr(const std::string& iface, const struct sockaddr* from,
                        struct sockaddr_in& out) {
    if (iface.empty()) return answer_ipv4(from, out);
    out = sockaddr_in{};
    out.sin_family = AF_INET;
    return ::inet_pton(AF_INET, iface.c_str(), &out.sin_addr) == 1;
}

// Socket address for an mDNS socket: on the chosen interface, mdns.h joins
// the group and sends there (POSIX: it still binds INADDR_ANY, so multicast
// arrives).
static struct sockaddr_in iface_saddr(const std::string& iface, uint16_t port) {
    struct sockaddr_in saddr{};
    saddr.sin_family = AF_INET;
    saddr.sin_port   = htons(port);
    saddr.sin_addr.s_addr = INADDR_ANY;
    if (!iface.empty()) ::inet_pton(AF_INET, iface.c_str(), &saddr.sin_addr);
#ifdef __APPLE__
    saddr.sin_len = sizeof(saddr);
#endif
    return saddr;
}

// The address multicast goes out from: the chosen interface's, else the
// primary address (the one the A record carries). With INADDR_ANY the OS picks
// the interface itself, and a Windows host with several adapters (Wi-Fi
// Direct, Bluetooth, VPN, WSL) picked a wrong one in some runs: peers on the
// LAN were never found. 0 if there is none (INADDR_ANY, as before).
static uint32_t send_ipv4(const std::string& iface) {
    struct in_addr a{};
    if (!iface.empty())
        return ::inet_pton(AF_INET, iface.c_str(), &a) == 1 ? a.s_addr : 0;
    return primary_ipv4(a) ? a.s_addr : 0;
}

static void set_multicast_if(int sock, uint32_t addr) {
    if (sock < 0) return;
    struct in_addr a{};
    a.s_addr = addr ? addr : htonl(INADDR_ANY);
    ::setsockopt(sock, IPPROTO_IP, IP_MULTICAST_IF,
                 reinterpret_cast<const char*>(&a), sizeof(a));
}

std::string MdnsDesktop::interface_ipv4(const char* iface, std::string* chosen) {
    if (!iface || !*iface) return "";
    struct in_addr a{};
    if (::inet_pton(AF_INET, iface, &a) == 1) {
        if (chosen) *chosen = iface;
        return iface;
    }
#ifndef _WIN32
    // A glob (en*, 192.168.*) matches names and addresses, and only
    // interfaces a node can use: link up, not loopback or link-local. Of
    // several, the primary address's interface (the default route), else the
    // first.
    const bool glob = std::strpbrk(iface, "*?[") != nullptr;
    struct in_addr primary{};
    const bool have_primary = glob && primary_ipv4(primary);
    struct ifaddrs* ifs = nullptr;
    if (::getifaddrs(&ifs) != 0) return "";
    std::string result;
    for (struct ifaddrs* i = ifs; i; i = i->ifa_next) {
        if (!i->ifa_addr || i->ifa_addr->sa_family != AF_INET) continue;
        if (!(i->ifa_flags & IFF_UP)) continue;
        const auto* sa = reinterpret_cast<const struct sockaddr_in*>(i->ifa_addr);
        char buf[INET_ADDRSTRLEN];
        if (!::inet_ntop(AF_INET, &sa->sin_addr, buf, sizeof(buf))) continue;
        if (glob) {
            if ((i->ifa_flags & IFF_LOOPBACK) || !(i->ifa_flags & IFF_RUNNING) ||
                !usable_ipv4(sa->sin_addr)) continue;
            if (::fnmatch(iface, i->ifa_name, 0) != 0 && ::fnmatch(iface, buf, 0) != 0) continue;
        } else if (std::strcmp(iface, i->ifa_name) != 0) {
            continue;
        }
        const bool best = !glob || (have_primary && sa->sin_addr.s_addr == primary.s_addr);
        if (result.empty() || best) {
            result = buf;
            if (chosen) *chosen = i->ifa_name;
        }
        if (best) break;
    }
    ::freeifaddrs(ifs);
    return result;
#else
    return ""; // Windows: an IPv4 address only
#endif
}

// (Re)point both sockets' outgoing multicast at send_ipv4() when it changed:
// a laptop that moves to another network follows. `force` after opening one.
void MdnsDesktop::pin_send_if(bool force) {
    const uint32_t a = send_ipv4(iface_);
    if (a == send_addr_ && !force) return;
    send_addr_ = a;
    set_multicast_if(service_sock_, a);
    set_multicast_if(query_sock_, a);
}

// ---------------------------------------------------------------------------
// construction / destruction
// ---------------------------------------------------------------------------

MdnsDesktop::MdnsDesktop() = default;

MdnsDesktop::~MdnsDesktop() {
    stop();
}

// ---------------------------------------------------------------------------
// sockaddr_to_string  (static helper)
// ---------------------------------------------------------------------------

void MdnsDesktop::sockaddr_to_string(const struct sockaddr* addr,
                                     size_t /*addrlen*/,
                                     char* buf, size_t buf_capacity) {
    buf[0] = '\0';
    if (addr->sa_family == AF_INET) {
        const auto* sa4 = reinterpret_cast<const struct sockaddr_in*>(addr);
        inet_ntop(AF_INET, &sa4->sin_addr, buf,
                  static_cast<socklen_t>(buf_capacity));
    } else if (addr->sa_family == AF_INET6) {
        const auto* sa6 = reinterpret_cast<const struct sockaddr_in6*>(addr);
        inet_ntop(AF_INET6, &sa6->sin6_addr, buf,
                  static_cast<socklen_t>(buf_capacity));
    }
}

// ---------------------------------------------------------------------------
// advertise
// ---------------------------------------------------------------------------

void MdnsDesktop::advertise(const char* name, const char* service_type,
                            uint16_t port,
                            const char* txt[], size_t txt_count) {
    Service svc;
    svc.name.assign(name);
    svc.type.assign(service_type);
    svc.port = port;

    for (size_t i = 0; i < txt_count; ++i) {
        svc.txt_kv.emplace_back(txt[i]);
        const char* eq = std::strchr(txt[i], '=');
        if (eq) {
            svc.txt_parsed.emplace_back(
                std::string(txt[i], static_cast<size_t>(eq - txt[i])),
                std::string(eq + 1));
        } else {
            svc.txt_parsed.emplace_back(std::string(txt[i]), std::string());
        }
    }

    svc.qualified_name = svc.name + "." + svc.type;

    // Build hostname_local_ once (shared across all services).
    if (hostname_local_.empty()) {
        char hostname_buf[256]{};
        ::gethostname(hostname_buf, sizeof(hostname_buf));
        hostname_local_.assign(hostname_buf);
        while (!hostname_local_.empty() && hostname_local_.back() == '.')
            hostname_local_.pop_back();
        const std::string local_sfx = ".local";
        if (hostname_local_.size() > local_sfx.size() &&
            hostname_local_.compare(hostname_local_.size() - local_sfx.size(),
                                    local_sfx.size(), local_sfx) == 0) {
            hostname_local_.erase(hostname_local_.size() - local_sfx.size());
        }
        hostname_local_ += ".local.";
    }

    // Open the shared mDNS socket once (port 5353).
    if (service_sock_ < 0) {
        const struct sockaddr_in saddr = iface_saddr(iface_, MDNS_PORT);
        service_sock_ = mdns_socket_open_ipv4(&saddr);
        if (service_sock_ < 0) {
            return;
        }
        pin_send_if(true);
        struct in_addr route{};
        route_addr_ = route_source_ipv4("224.0.0.251", MDNS_PORT, route) &&
                      usable_ipv4(route) ? route.s_addr : 0;
        join_multicast_groups();
    }

    // Update in place if a service with the same name+type already exists.
    for (auto& existing : services_) {
        if (existing.name == svc.name && existing.type == svc.type) {
            existing.port       = svc.port;
            existing.txt_kv     = std::move(svc.txt_kv);
            existing.txt_parsed = std::move(svc.txt_parsed);
            send_announcement(existing);
            return;
        }
    }

    services_.push_back(std::move(svc));
    send_announcement(services_.back());
}

// Build SRV + TXT (+ A) additional records for the current service.  Used by
// both send_announcement() (initial multicast) and handle_question() (query
// response).  The records reference the passed strings, so the caller must
// ensure they outlive the records.  `addr` (may be null) becomes the A
// record of the SRV target: the ESP32 W5500 PAL ignores answers without one.
static void build_additional(std::vector<mdns_record_t>& out,
                             const std::string& qualified_name,
                             const std::string& hostname_local,
                             uint16_t port,
                             const std::vector<std::pair<std::string, std::string>>& txt_parsed,
                             const struct sockaddr_in* addr) {
    // SRV record
    mdns_record_t record_srv{};
    record_srv.name              = mdns_string_t{qualified_name.c_str(),
                                                  qualified_name.size()};
    record_srv.type              = MDNS_RECORDTYPE_SRV;
    record_srv.data.srv.priority = 0;
    record_srv.data.srv.weight   = 0;
    record_srv.data.srv.port     = port;
    record_srv.data.srv.name     = mdns_string_t{hostname_local.c_str(),
                                                   hostname_local.size()};
    record_srv.rclass            = 0;
    record_srv.ttl               = 120;
    out.push_back(record_srv);

    // TXT records
    for (size_t i = 0; i < txt_parsed.size(); ++i) {
        mdns_record_t rec{};
        rec.name           = mdns_string_t{qualified_name.c_str(),
                                            qualified_name.size()};
        rec.type           = MDNS_RECORDTYPE_TXT;
        rec.data.txt.key   = mdns_string_t{txt_parsed[i].first.c_str(),
                                            txt_parsed[i].first.size()};
        rec.data.txt.value = mdns_string_t{txt_parsed[i].second.c_str(),
                                            txt_parsed[i].second.size()};
        rec.rclass         = 0;
        rec.ttl            = 120;
        out.push_back(rec);
    }

    // A record for the SRV target
    if (addr) {
        mdns_record_t rec{};
        rec.name        = mdns_string_t{hostname_local.c_str(), hostname_local.size()};
        rec.type        = MDNS_RECORDTYPE_A;
        rec.data.a.addr = *addr;
        rec.rclass      = 0;
        rec.ttl         = 120;
        out.push_back(rec);
    }
}

void MdnsDesktop::send_announcement(const Service& svc) {
    if (service_sock_ < 0 || svc.name.empty()) return;

    mdns_record_t record_ptr{};
    record_ptr.name          = mdns_string_t{svc.type.c_str(),
                                              svc.type.size()};
    record_ptr.type          = MDNS_RECORDTYPE_PTR;
    record_ptr.data.ptr.name = mdns_string_t{svc.qualified_name.c_str(),
                                              svc.qualified_name.size()};
    record_ptr.rclass        = 0;
    record_ptr.ttl           = 120;

    struct sockaddr_in addr{};
    const bool have_addr = answer_addr(iface_, nullptr, addr);
    std::vector<mdns_record_t> additional;
    build_additional(additional, svc.qualified_name, hostname_local_,
                     svc.port, svc.txt_parsed, have_addr ? &addr : nullptr);

    // DNS-SD service type enumeration record (RFC 6763 Section 9)
    static const char kMetaQuery[] = "_services._dns-sd._udp.local.";
    mdns_record_t meta_ptr{};
    meta_ptr.name          = mdns_string_t{kMetaQuery, sizeof(kMetaQuery) - 1};
    meta_ptr.type          = MDNS_RECORDTYPE_PTR;
    meta_ptr.data.ptr.name = mdns_string_t{svc.type.c_str(), svc.type.size()};
    meta_ptr.rclass        = 0;
    meta_ptr.ttl           = 4500;
    additional.push_back(meta_ptr);

    mdns_announce_multicast(service_sock_, answer_buf_, kBufSize,
                            record_ptr, nullptr, 0,
                            additional.data(), additional.size());
}

// ---------------------------------------------------------------------------
// handle_question  (respond to incoming mDNS queries)
// ---------------------------------------------------------------------------

void MdnsDesktop::handle_question(int sock, const struct sockaddr* from,
                                  size_t addrlen, uint16_t query_id,
                                  uint16_t rtype, uint16_t rclass,
                                  const void* data, size_t size,
                                  size_t name_offset) {
    if (services_.empty()) return;

    // Extract the queried name.
    char name_buf[256]{};
    size_t offset = name_offset;
    mdns_string_t name = mdns_string_extract(data, size, &offset,
                                             name_buf, sizeof(name_buf));

    uint16_t unicast = (rclass & MDNS_UNICAST_RESPONSE);

    // --- A / AAAA query for our hostname ---
    if (rtype == MDNS_RECORDTYPE_A || rtype == MDNS_RECORDTYPE_AAAA ||
        rtype == MDNS_RECORDTYPE_ANY) {
        if (name.length == hostname_local_.size() &&
            std::strncmp(name.str, hostname_local_.c_str(), name.length) == 0) {

            // Build an A record with our address (same choice as in the
            // service answers, so a peer always sees one address).
            struct sockaddr_in local_addr{};
            answer_addr(iface_, unicast ? from : nullptr, local_addr);

            if (local_addr.sin_addr.s_addr != 0) {
                mdns_record_t answer{};
                answer.name = mdns_string_t{hostname_local_.c_str(),
                                             hostname_local_.size()};
                answer.type = MDNS_RECORDTYPE_A;
                answer.data.a.addr = *reinterpret_cast<struct sockaddr_in*>(&local_addr);
                answer.rclass = 0;
                answer.ttl = 120;

                if (unicast) {
                    mdns_query_answer_unicast(sock, from, addrlen,
                                              answer_buf_, kBufSize, query_id,
                                              static_cast<mdns_record_type_t>(rtype),
                                              name.str, name.length,
                                              answer, nullptr, 0, nullptr, 0);
                } else {
                    mdns_query_answer_multicast(sock, answer_buf_, kBufSize,
                                                answer, nullptr, 0, nullptr, 0);
                }
            }
            return;
        }
    }

    // --- DNS-SD service type enumeration (RFC 6763 Section 9) ---
    static const char kMetaQuery[] = "_services._dns-sd._udp.local.";
    if (rtype == MDNS_RECORDTYPE_PTR || rtype == MDNS_RECORDTYPE_ANY) {
        if (name.length == sizeof(kMetaQuery) - 1 &&
            std::strncmp(name.str, kMetaQuery, name.length) == 0) {
            // Respond with a PTR record for each unique service type.
            std::vector<std::string> seen;
            for (const auto& svc : services_) {
                bool dup = false;
                for (const auto& s : seen) { if (s == svc.type) { dup = true; break; } }
                if (dup) continue;
                seen.push_back(svc.type);

                mdns_record_t answer{};
                answer.name          = mdns_string_t{kMetaQuery, sizeof(kMetaQuery) - 1};
                answer.type          = MDNS_RECORDTYPE_PTR;
                answer.data.ptr.name = mdns_string_t{svc.type.c_str(), svc.type.size()};
                answer.rclass        = 0;
                answer.ttl           = 4500;

                if (unicast) {
                    mdns_query_answer_unicast(sock, from, addrlen,
                                              answer_buf_, kBufSize, query_id,
                                              static_cast<mdns_record_type_t>(rtype),
                                              name.str, name.length,
                                              answer, nullptr, 0, nullptr, 0);
                } else {
                    mdns_query_answer_multicast(sock, answer_buf_, kBufSize,
                                                answer, nullptr, 0, nullptr, 0);
                }
            }
            return;
        }
    }

    for (const auto& svc : services_) {
        // --- PTR / ANY query for service type ---
        if (rtype == MDNS_RECORDTYPE_PTR || rtype == MDNS_RECORDTYPE_ANY) {
            if (name.length == svc.type.size() &&
                std::strncmp(name.str, svc.type.c_str(), name.length) == 0) {

                mdns_record_t answer{};
                answer.name          = mdns_string_t{svc.type.c_str(),
                                                      svc.type.size()};
                answer.type          = MDNS_RECORDTYPE_PTR;
                answer.data.ptr.name = mdns_string_t{svc.qualified_name.c_str(),
                                                      svc.qualified_name.size()};
                answer.rclass        = 0;
                answer.ttl           = 120;

                struct sockaddr_in addr{};
                const bool have_addr = answer_addr(iface_, unicast ? from : nullptr, addr);
                std::vector<mdns_record_t> additional;
                build_additional(additional, svc.qualified_name, hostname_local_,
                                 svc.port, svc.txt_parsed, have_addr ? &addr : nullptr);

                if (unicast) {
                    mdns_query_answer_unicast(sock, from, addrlen,
                                              answer_buf_, kBufSize, query_id,
                                              static_cast<mdns_record_type_t>(rtype),
                                              name.str, name.length,
                                              answer, nullptr, 0,
                                              additional.data(), additional.size());
                } else {
                    mdns_query_answer_multicast(sock, answer_buf_, kBufSize,
                                                answer, nullptr, 0,
                                                additional.data(), additional.size());
                }
            }
        }

        // --- SRV / TXT / ANY query for qualified instance name ---
        if (rtype == MDNS_RECORDTYPE_SRV || rtype == MDNS_RECORDTYPE_TXT ||
            rtype == MDNS_RECORDTYPE_ANY) {
            if (name.length == svc.qualified_name.size() &&
                std::strncmp(name.str, svc.qualified_name.c_str(), name.length) == 0) {

                struct sockaddr_in addr{};
                const bool have_addr = answer_addr(iface_, unicast ? from : nullptr, addr);
                std::vector<mdns_record_t> additional;
                build_additional(additional, svc.qualified_name, hostname_local_,
                                 svc.port, svc.txt_parsed, have_addr ? &addr : nullptr);

                // Answer with all SRV + TXT (+ A) records.
                mdns_record_t answer = additional[0]; // SRV is always first
                if (unicast) {
                    mdns_query_answer_unicast(sock, from, addrlen,
                                              answer_buf_, kBufSize, query_id,
                                              static_cast<mdns_record_type_t>(rtype),
                                              name.str, name.length,
                                              answer, nullptr, 0,
                                              additional.data() + 1,
                                              additional.size() - 1);
                } else {
                    mdns_query_answer_multicast(sock, answer_buf_, kBufSize,
                                                answer, nullptr, 0,
                                                additional.data() + 1,
                                                additional.size() - 1);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// browse
// ---------------------------------------------------------------------------

void MdnsDesktop::browse(const char* service_type) {
    browse_type_.assign(service_type);

    // Open an ephemeral-port socket for sending the query and receiving
    // unicast responses.
    if (query_sock_ < 0) {
        const struct sockaddr_in saddr = iface_saddr(iface_, 0);
        query_sock_ = mdns_socket_open_ipv4(iface_.empty() ? nullptr : &saddr);
        if (query_sock_ < 0) {
            return;
        }
        pin_send_if(true);
    }

    // Send a PTR query for the requested service type.
    query_id_ = mdns_query_send(query_sock_, MDNS_RECORDTYPE_PTR,
                                browse_type_.c_str(), browse_type_.size(),
                                buffer_, kBufSize, 0);
}

// ---------------------------------------------------------------------------
// poll_event
// ---------------------------------------------------------------------------

bool MdnsDesktop::poll_event(MdnsEvent& out) {
    refresh();

    // If we already have queued events, return one immediately.
    if (!events_.empty()) {
        out = events_.front();
        events_.erase(events_.begin());
        return true;
    }

    // Non-blocking receive on the query socket (picks up answers to our
    // browse query from other nodes).
    if (query_sock_ >= 0) {
        mdns_query_recv(query_sock_, buffer_, kBufSize,
                        mdns_desktop_callback, this, query_id_);
        flush_pending();
    }

    // Drain the service socket — this receives both multicast announcements
    // from other nodes (ANSWER entries) and browse queries from other nodes
    // (QUESTION entries, which we respond to via handle_question).
    if (service_sock_ >= 0) {
        mdns_socket_listen(service_sock_, buffer_, kBufSize,
                           mdns_desktop_callback, this);
        flush_pending();
    }

    if (!events_.empty()) {
        out = events_.front();
        events_.erase(events_.begin());
        return true;
    }

    return false;
}

// ---------------------------------------------------------------------------
// Keeping discovery alive
// ---------------------------------------------------------------------------

namespace {
constexpr int64_t kRefreshCheckMs  = 3000;  // membership + route check
constexpr int64_t kQueryIntervalMs = 15000; // periodic QM query (+ 0..3 s jitter)

int64_t steady_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// IPv4 addresses to join 224.0.0.251 on and query from: the chosen interface's
// alone if there is one; else the primary address, the route's towards
// 224.0.0.251 (Windows can return 127.0.0.1 for it), then (POSIX) every other
// interface that is up and does multicast.
std::vector<struct in_addr> multicast_ifaces(const std::string& iface) {
    std::vector<struct in_addr> out;
    auto add = [&out](const struct in_addr& a) {
        for (const auto& x : out) if (x.s_addr == a.s_addr) return;
        out.push_back(a);
    };
    if (!iface.empty()) {
        struct in_addr a{};
        if (::inet_pton(AF_INET, iface.c_str(), &a) == 1) add(a);
        return out;
    }
    struct in_addr p{};
    if (primary_ipv4(p)) add(p);
    struct in_addr r{};
    if (route_source_ipv4("224.0.0.251", MDNS_PORT, r) && usable_ipv4(r)) add(r);
#ifndef _WIN32
    struct ifaddrs* ifs = nullptr;
    if (::getifaddrs(&ifs) == 0) {
        for (struct ifaddrs* i = ifs; i; i = i->ifa_next) {
            if (!i->ifa_addr || i->ifa_addr->sa_family != AF_INET) continue;
            if (!(i->ifa_flags & IFF_UP) || !(i->ifa_flags & IFF_MULTICAST) ||
                (i->ifa_flags & IFF_LOOPBACK)) continue;
            const auto* sa = reinterpret_cast<const struct sockaddr_in*>(i->ifa_addr);
            if (usable_ipv4(sa->sin_addr)) add(sa->sin_addr);
        }
        ::freeifaddrs(ifs);
    }
#endif
    return out;
}
} // namespace

// Membership is per interface. At open the kernel joined the one the route
// pointed to; a cable plugged later, or a Wi-Fi that reconnected (Windows and
// macOS drop the membership with the link), then heard nothing. Re-adding an
// existing membership just fails (EADDRINUSE), so this runs every check.
void MdnsDesktop::join_multicast_groups() {
    if (service_sock_ < 0) return;
    for (const auto& a : multicast_ifaces(iface_)) {
        struct ip_mreq req{};
        req.imr_multiaddr.s_addr = htonl((224u << 24) | 251u);
        req.imr_interface = a;
        ::setsockopt(service_sock_, IPPROTO_IP, IP_ADD_MEMBERSHIP,
                     reinterpret_cast<const char*>(&req), sizeof(req));
    }
}

// A PTR query sent from port 5353 has the QU bit clear, so every node that
// hears it answers by multicast, and every node hears every answer: nodes that
// lost each other find each other again, including older nodes that never
// query again themselves. Sent on each interface (multi-homed host: venue
// Wi-Fi + installation cable).
void MdnsDesktop::send_refresh_query() {
    if (service_sock_ < 0 || browse_type_.empty()) return;
    const auto ifaces = multicast_ifaces(iface_);
    for (const auto& a : ifaces) {
        set_multicast_if(service_sock_, a.s_addr);
        mdns_query_send(service_sock_, MDNS_RECORDTYPE_PTR,
                        browse_type_.c_str(), browse_type_.size(),
                        buffer_, kBufSize, 0);
    }
    // Back to the sending interface (not INADDR_ANY: see send_ipv4())
    set_multicast_if(service_sock_, send_addr_);
}

void MdnsDesktop::refresh() {
    const int64_t now = steady_ms();
    if (now < next_refresh_ms_) return;
    next_refresh_ms_ = now + kRefreshCheckMs;
    if (service_sock_ < 0) return;

    pin_send_if(false);

    struct in_addr r{};
    const uint32_t route = route_source_ipv4("224.0.0.251", MDNS_PORT, r) &&
                           usable_ipv4(r) ? r.s_addr : 0;
    if (route == 0) {          // no network right now: announce again on return
        route_addr_ = 0;
        return;
    }

    join_multicast_groups();

    if (route != route_addr_) {
        // Joined a (new) network: say we are here and ask who is, now.
        route_addr_ = route;
        for (const auto& svc : services_) send_announcement(svc);
        next_query_ms_ = now;
    }
    if (now >= next_query_ms_) {
        send_refresh_query();
        // Jitter from our address and the clock so nodes don't query in step.
        const uint64_t mix = (static_cast<uint64_t>(route) ^ static_cast<uint64_t>(now)) *
                             0x9E3779B97F4A7C15ull;
        next_query_ms_ = now + kQueryIntervalMs + static_cast<int64_t>((mix >> 33) % 3000);
    }
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

void MdnsDesktop::stop() {
    // Send goodbye for each advertised service before closing the socket.
    if (service_sock_ >= 0) {
        for (const auto& svc : services_) {
            mdns_record_t record_ptr{};
            record_ptr.name          = mdns_string_t{svc.type.c_str(),
                                                      svc.type.size()};
            record_ptr.type          = MDNS_RECORDTYPE_PTR;
            record_ptr.data.ptr.name = mdns_string_t{svc.qualified_name.c_str(),
                                                       svc.qualified_name.size()};
            record_ptr.rclass        = 0;
            record_ptr.ttl           = 0;

            mdns_goodbye_multicast(service_sock_, buffer_, kBufSize,
                                   record_ptr, nullptr, 0, nullptr, 0);
        }
    }

    if (service_sock_ >= 0) {
        mdns_socket_close(service_sock_);
        service_sock_ = -1;
    }
    if (query_sock_ >= 0) {
        mdns_socket_close(query_sock_);
        query_sock_ = -1;
    }

    events_.clear();
    pending_.clear();
    services_.clear();
    hostname_local_.clear();
}

// ---------------------------------------------------------------------------
// flush_pending  (move completed pending peers into the event queue)
// ---------------------------------------------------------------------------

void MdnsDesktop::flush_pending() {
    for (auto& peer : pending_) {
        // We consider a peer "complete enough" if we have at least a name.
        if (peer.instance_name.empty()) {
            continue;
        }

        MdnsEvent ev{};
        ev.type = MdnsEvent::PeerFound;

        // Truncate-safe copy into the fixed etl::string fields.
        ev.name.assign(peer.instance_name.c_str(),
                       std::min(peer.instance_name.size(),
                                static_cast<size_t>(ev.name.max_size())));

        // Address: the A record of the SRV target (AAAA if there is none),
        // else the packet source set by the PTR. A single-service packet
        // takes its A record whatever its name.
        const PendingAddr* best = nullptr;
        for (const auto& a : pending_addrs_) {
            if (!dns_name_equal(a.hostname, peer.hostname)) continue;
            if (!a.v6) { best = &a; break; }
            if (!best) best = &a;
        }
        if (!best && pending_.size() == 1) {
            for (const auto& a : pending_addrs_) {
                if (!a.v6) { best = &a; break; }
                if (!best) best = &a;
            }
        }
        if (best) peer.address = best->address;

        ev.address.assign(peer.address.c_str(),
                          std::min(peer.address.size(),
                                   static_cast<size_t>(ev.address.max_size())));

        ev.port = peer.port;

        ev.sku.assign(peer.sku.c_str(),
                      std::min(peer.sku.size(),
                               static_cast<size_t>(ev.sku.max_size())));

        ev.universe.assign(peer.universe.c_str(),
                           std::min(peer.universe.size(),
                                    static_cast<size_t>(ev.universe.max_size())));
        ev.core_major = peer.core_major;
        ev.core_ver = peer.core_ver.c_str();
        ev.role = peer.role;

        events_.push_back(ev);
    }
    pending_.clear();
    pending_addrs_.clear();
}

// The service type of an instance name: what follows its first label
// ("burton16._http._tcp.local." -> "_http._tcp.local.").
static bool type_of(const char* name, size_t len, const char*& type, size_t& tlen) {
    const char* dot = static_cast<const char*>(std::memchr(name, '.', len));
    if (!dot || dot + 1 >= name + len || dot[1] != '_') return false;
    type = dot + 1;
    tlen = len - static_cast<size_t>(type - name);
    return true;
}

bool MdnsDesktop::browsing(const char* type, size_t len) const {
    return !browse_type_.empty() &&
           dns_name_equal(type, len, browse_type_.c_str(), browse_type_.size());
}

MdnsDesktop::PendingPeer* MdnsDesktop::pending_for(const char* name, size_t len) {
    for (auto it = pending_.rbegin(); it != pending_.rend(); ++it) {
        if (dns_name_equal(it->instance_name.c_str(), it->instance_name.size(), name, len))
            return &*it;
    }
    // A record of another service (the node's _http._tcp next to its
    // _dataflou._tcp in one answer) belongs to none of ours: its port and TXT
    // must not land on the peer.
    const char* type = nullptr;
    size_t tlen = 0;
    if (type_of(name, len, type, tlen) && !browsing(type, tlen)) return nullptr;
    // Responders that name records differently: the last PTR seen.
    return pending_.empty() ? nullptr : &pending_.back();
}

} // namespace dataflou
