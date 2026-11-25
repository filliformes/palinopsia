#pragma once

#include "dataflou/pal.h"

#ifndef ASIO_NO_EXCEPTIONS
#define ASIO_NO_EXCEPTIONS
#endif
#include <asio.hpp>

#include <cstdint>
#include <memory>
#include <vector>

namespace dataflou {

class UdpAsio : public IUdp {
public:
    UdpAsio();

    UdpHandle bind(uint16_t port) override;
    uint16_t  local_port(UdpHandle h) override;
    int       send_to(UdpHandle h, etl::span<const uint8_t> data,
                      const char* addr, uint16_t port) override;
    int       recv_from(UdpHandle h, etl::span<uint8_t> buf,
                        char* out_addr, size_t addr_max, uint16_t& out_port) override;
    void      close(UdpHandle h) override;

private:
    struct Entry {
        std::unique_ptr<asio::ip::udp::socket> socket;
        bool closed = true;
        uint16_t bound_port = 0;
    };

    UdpHandle alloc_entry();
    bool valid(UdpHandle h) const;

    asio::io_context ctx_;
    std::vector<Entry> entries_;
};

} // namespace dataflou
