#pragma once

#include "dataflou/pal.h"

namespace dataflou {

/// Bundle of platform-specific PAL implementations.
/// Returned by default_platform(), which is provided by each platform
/// target (dataflou_desktop, esp32 PAL, etc.) and resolved at link time.
struct Platform {
    ITcp&     tcp;
    IMdns&    mdns;
    IClock&   clock;
    IStorage& storage;
    IUdp&     udp;
};

/// Returns the platform PAL bundle using static instances.
/// Implemented per platform target — link the appropriate target to select.
///
/// storage_hint: platform-specific. On desktop, used as the filesystem
/// directory for StorageFile (defaults to "." if nullptr).
/// Ignored on platforms with built-in storage (ESP32 Preferences, etc.).
///
/// Must be called exactly once; subsequent calls return the same objects.
Platform& default_platform(const char* storage_hint = nullptr);

} // namespace dataflou
