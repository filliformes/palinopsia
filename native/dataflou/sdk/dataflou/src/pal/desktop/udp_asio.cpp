#include "desktop/udp_asio.h"
#include <cstring>

// ASIO requires a throw function even with ASIO_NO_EXCEPTIONS
namespace asio::detail {
template <typename Exception>
void throw_exception(const Exception&) { std::abort(); }
}

namespace dataflou {

UdpAsio::UdpAsio() {}

UdpHandle UdpAsio::alloc_entry() {
    for (size_t i = 0; i < entries_.size(); ++i) {
        if (entries_[i].closed) return static_cast<UdpHandle>(i);
    }
    entries_.emplace_back();
    return static_cast<UdpHandle>(entries_.size() - 1);
}

bool UdpAsio::valid(UdpHandle h) const {
    return h >= 0 && static_cast<size_t>(h) < entries_.size() && !entries_[h].closed;
}

UdpHandle UdpAsio::bind(uint16_t port) {
    UdpHandle h = alloc_entry();
    auto& e = entries_[static_cast<size_t>(h)];

    asio::error_code ec;
    e.socket = std::make_unique<asio::ip::udp::socket>(ctx_);
    e.socket->open(asio::ip::udp::v4(), ec);
    if (ec) return INVALID_UDP_HANDLE;

    e.socket->set_option(asio::socket_base::reuse_address(true), ec);
    // Broadcasts may be sent from it (Art-Net); best effort
    asio::error_code bec;
    e.socket->set_option(asio::socket_base::broadcast(true), bec);
    e.socket->bind(asio::ip::udp::endpoint(asio::ip::udp::v4(), port), ec);
    if (ec) {
        e.socket.reset();
        return INVALID_UDP_HANDLE;
    }

    e.socket->non_blocking(true, ec);
    e.bound_port = e.socket->local_endpoint(ec).port();
    e.closed = false;
    return h;
}

uint16_t UdpAsio::local_port(UdpHandle h) {
    if (!valid(h)) return 0;
    return entries_[static_cast<size_t>(h)].bound_port;
}

int UdpAsio::send_to(UdpHandle h, etl::span<const uint8_t> data,
                     const char* addr, uint16_t port) {
    if (!valid(h)) return -1;
    auto& e = entries_[static_cast<size_t>(h)];

    asio::error_code ec;
    asio::ip::udp::endpoint ep(asio::ip::make_address(addr, ec), port);
    if (ec) return -1;

    auto sent = e.socket->send_to(asio::buffer(data.data(), data.size()), ep, 0, ec);
    if (ec) return -1;
    return static_cast<int>(sent);
}

int UdpAsio::recv_from(UdpHandle h, etl::span<uint8_t> buf,
                       char* out_addr, size_t addr_max, uint16_t& out_port) {
    if (!valid(h)) return -1;
    auto& e = entries_[static_cast<size_t>(h)];

    asio::ip::udp::endpoint sender;
    asio::error_code ec;
    auto n = e.socket->receive_from(asio::buffer(buf.data(), buf.size()), sender, 0, ec);
    if (ec) {
        if (ec == asio::error::would_block) return 0;
        return -1;
    }

    auto addr_str = sender.address().to_string();
    if (out_addr && addr_max > 0) {
        std::strncpy(out_addr, addr_str.c_str(), addr_max - 1);
        out_addr[addr_max - 1] = '\0';
    }
    out_port = sender.port();
    return static_cast<int>(n);
}

void UdpAsio::close(UdpHandle h) {
    if (!valid(h)) return;
    auto& e = entries_[static_cast<size_t>(h)];
    asio::error_code ec;
    if (e.socket) {
        e.socket->close(ec);
        e.socket.reset();
    }
    e.closed = true;
}

} // namespace dataflou
