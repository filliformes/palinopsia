#include <dataflou/platform.h>
#include "desktop/tcp_asio.h"
#include "desktop/mdns_platform.h"
#include "desktop/clock_std.h"
#include "desktop/storage_file.h"
#include "desktop/udp_asio.h"

namespace dataflou {

Platform& default_platform(const char* storage_hint) {
    static TcpAsio     tcp;
    static MdnsPlatform mdns;   // Bonjour on Apple (mdns_platform.h)
    static ClockStd    clock;
    static StorageFile storage(storage_hint ? storage_hint : ".");
    static UdpAsio     udp;
    static Platform    p{tcp, mdns, clock, storage, udp};
    return p;
}

} // namespace dataflou
