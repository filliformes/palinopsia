// mdns_platform.h — the discovery a node uses on this platform, chosen here
// and nowhere else: Bonjour on Apple platforms (MdnsDnssd, src/pal/apple: the
// system's daemon, which says when a node leaves and follows the local
// network permission), the desktop mDNS elsewhere (MdnsDesktop, raw
// multicast sockets: Linux, Windows). dataflou-node, its adapters, the C
// interface and the tests all build their node on MdnsPlatform.
//
// MdnsDesktop stays in the library on every platform: a host may still use
// it for something else (MdnsDesktop::interface_ipv4(), a browse of its own).
#pragma once

#if defined(__APPLE__)
#include "apple/mdns_dnssd.h"
#else
#include "desktop/mdns_mjansson.h"
#endif

#include <string>

namespace dataflou {

#if defined(__APPLE__)
using MdnsPlatform = MdnsDnssd;
#else
using MdnsPlatform = MdnsDesktop;
#endif

// Discovery on one interface, as MdnsDesktop::interface_ipv4() found it: its
// name ("en0") and its IPv4 address. Bonjour takes the name, the desktop mDNS
// the address. Before advertise() / browse().
inline void use_interface(MdnsPlatform& mdns, const std::string& name, const std::string& ipv4) {
#if defined(__APPLE__)
    (void)ipv4;
    mdns.set_interface(name.c_str());
#else
    (void)name;
    mdns.set_interface(ipv4.c_str());
#endif
}

// "ok", or what is wrong ("local network access denied"): Bonjour knows, the
// desktop mDNS does not.
inline const char* discovery_status(const MdnsPlatform& mdns) {
#if defined(__APPLE__)
    return mdns.status();
#else
    (void)mdns;
    return "ok";
#endif
}

} // namespace dataflou
