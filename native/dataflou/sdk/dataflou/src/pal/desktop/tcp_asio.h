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

class TcpAsio : public ITcp {
public:
    TcpAsio();

    SocketHandle listen(uint16_t port) override;
    uint16_t local_port(SocketHandle listener) override;
    SocketHandle accept(SocketHandle listener) override;
    SocketHandle connect(const char* addr, uint16_t port) override;
    int send(SocketHandle s, etl::span<const uint8_t> data) override;
    int recv(SocketHandle s, etl::span<uint8_t> buf) override;
    bool is_connected(SocketHandle s) override;
    void close(SocketHandle s) override;
    bool remote_addr(SocketHandle s, char* out_addr, size_t addr_max) override;

private:
    struct Entry {
        std::unique_ptr<asio::ip::tcp::socket>   socket;
        std::unique_ptr<asio::ip::tcp::acceptor> acceptor;
        bool connecting = false;
        bool connected  = false;
        bool closed     = true;
        uint16_t bound_port = 0;
    };

    SocketHandle alloc_entry();
    bool valid(SocketHandle h) const;

    asio::io_context ctx_;
    std::vector<Entry> entries_;
    std::vector<SocketHandle> free_list_;
};

} // namespace dataflou
