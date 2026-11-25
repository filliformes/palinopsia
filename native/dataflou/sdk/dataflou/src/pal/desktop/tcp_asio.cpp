#include "desktop/tcp_asio.h"

#include <cerrno>
#include <cstdlib>

// ASIO requires a custom throw_exception when compiled with ASIO_NO_EXCEPTIONS.
namespace asio::detail {
    template <typename Exception>
    void throw_exception(const Exception& /*e*/) {
        std::abort();
    }
} // namespace asio::detail

#if defined(_WIN32)
#include <winsock2.h>
#else
#include <poll.h>
#include <sys/socket.h>
#endif

namespace dataflou {

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

TcpAsio::TcpAsio() = default;

SocketHandle TcpAsio::alloc_entry() {
    if (!free_list_.empty()) {
        SocketHandle h = free_list_.back();
        free_list_.pop_back();
        entries_[static_cast<size_t>(h)] = Entry{};
        return h;
    }
    SocketHandle h = static_cast<SocketHandle>(entries_.size());
    entries_.emplace_back();
    return h;
}

bool TcpAsio::valid(SocketHandle h) const {
    if (h < 0 || static_cast<size_t>(h) >= entries_.size()) return false;
    return !entries_[static_cast<size_t>(h)].closed;
}

// ---------------------------------------------------------------------------
// listen
// ---------------------------------------------------------------------------

SocketHandle TcpAsio::listen(uint16_t port) {
    asio::error_code ec;

    auto acceptor = std::make_unique<asio::ip::tcp::acceptor>(ctx_);

    acceptor->open(asio::ip::tcp::v4(), ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    acceptor->set_option(asio::ip::tcp::acceptor::reuse_address(true), ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    asio::ip::tcp::endpoint ep(asio::ip::tcp::v4(), port);
    acceptor->bind(ep, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    acceptor->listen(asio::socket_base::max_listen_connections, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    acceptor->non_blocking(true, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    SocketHandle h = alloc_entry();
    auto& entry = entries_[static_cast<size_t>(h)];
    entry.acceptor = std::move(acceptor);
    entry.bound_port = entry.acceptor->local_endpoint().port();
    entry.connected = false;
    entry.connecting = false;
    entry.closed = false;
    return h;
}

// ---------------------------------------------------------------------------
// local_port
// ---------------------------------------------------------------------------

uint16_t TcpAsio::local_port(SocketHandle listener) {
    if (!valid(listener)) return 0;
    auto& entry = entries_[static_cast<size_t>(listener)];
    if (!entry.acceptor) return 0;
    return entry.bound_port;
}

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------

SocketHandle TcpAsio::accept(SocketHandle listener) {
    if (!valid(listener)) return INVALID_SOCKET_HANDLE;
    auto& entry = entries_[static_cast<size_t>(listener)];
    if (!entry.acceptor) return INVALID_SOCKET_HANDLE;

    auto peer = std::make_unique<asio::ip::tcp::socket>(ctx_);
    asio::error_code ec;
    entry.acceptor->accept(*peer, ec);

    if (ec == asio::error::would_block || ec == asio::error::try_again) {
        return INVALID_SOCKET_HANDLE;
    }
    if (ec) {
        return INVALID_SOCKET_HANDLE;
    }

    peer->non_blocking(true, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    SocketHandle h = alloc_entry();
    auto& peer_entry = entries_[static_cast<size_t>(h)];
    peer_entry.socket = std::move(peer);
    peer_entry.connected = true;
    peer_entry.connecting = false;
    peer_entry.closed = false;
    return h;
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

SocketHandle TcpAsio::connect(const char* addr, uint16_t port) {
    asio::error_code ec;

    asio::ip::address address = asio::ip::make_address(addr, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    asio::ip::tcp::endpoint ep(address, port);

    auto sock = std::make_unique<asio::ip::tcp::socket>(ctx_);
    sock->open(asio::ip::tcp::v4(), ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    sock->non_blocking(true, ec);
    if (ec) return INVALID_SOCKET_HANDLE;

    // Native connect: asio's socket::connect() waits for the handshake to
    // finish even on a non-blocking socket, which froze the whole node until
    // the SYN timed out (~20 s) whenever a peer advertised an address that
    // isn't reachable. is_connected() completes the connection.
    bool already_connected = false;
    if (::connect(sock->native_handle(),
                  reinterpret_cast<const struct sockaddr*>(ep.data()),
                  static_cast<int>(ep.size())) == 0) {
        // Loopback connections may succeed immediately.
        already_connected = true;
    } else {
#if defined(_WIN32)
        const int err = ::WSAGetLastError();
        if (err != WSAEWOULDBLOCK && err != WSAEINPROGRESS) return INVALID_SOCKET_HANDLE;
#else
        if (errno != EINPROGRESS && errno != EWOULDBLOCK) return INVALID_SOCKET_HANDLE;
#endif
        // Connection is proceeding asynchronously — expected.
    }

    SocketHandle h = alloc_entry();
    auto& entry = entries_[static_cast<size_t>(h)];
    entry.socket = std::move(sock);
    entry.connecting = !already_connected;
    entry.connected = already_connected;
    entry.closed = false;
    return h;
}

// ---------------------------------------------------------------------------
// is_connected
// ---------------------------------------------------------------------------

bool TcpAsio::is_connected(SocketHandle s) {
    if (!valid(s)) return false;
    auto& entry = entries_[static_cast<size_t>(s)];
    if (!entry.socket) return false;
    if (entry.connected) return true;
    if (!entry.connecting) return false;

    // The connect has completed once the socket is writable (or, on Windows,
    // flagged in the except set when it failed); SO_ERROR then tells success
    // from failure. (getpeername() can't be used: Windows answers it while
    // the connect is still in progress.)
    const auto fd = entry.socket->native_handle();
#if defined(_WIN32)
    fd_set wfds, efds;
    FD_ZERO(&wfds);
    FD_ZERO(&efds);
    FD_SET(fd, &wfds);
    FD_SET(fd, &efds);
    timeval tv{0, 0};
    if (::select(0, nullptr, &wfds, &efds, &tv) <= 0) return false; // in progress
    const bool failed_now = FD_ISSET(fd, &efds) != 0;
#else
    struct pollfd pfd{fd, POLLOUT, 0};
    if (::poll(&pfd, 1, 0) <= 0) return false; // in progress
    const bool failed_now = (pfd.revents & (POLLERR | POLLHUP)) != 0 &&
                            (pfd.revents & POLLOUT) == 0;
#endif
    int err = 0;
    socklen_t len = sizeof(err);
    const int rc = ::getsockopt(fd, SOL_SOCKET, SO_ERROR,
                                reinterpret_cast<char*>(&err), &len);
    entry.connecting = false;
    if (failed_now || rc != 0 || err != 0) {
        // Refused / unreachable: never connects (the node drops the dial).
        return false;
    }
    entry.connected = true;
    return true;
}

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

int TcpAsio::send(SocketHandle s, etl::span<const uint8_t> data) {
    if (!valid(s)) return -1;
    auto& entry = entries_[static_cast<size_t>(s)];
    if (!entry.socket) return -1;

    asio::error_code ec;
    size_t n = entry.socket->write_some(asio::buffer(data.data(), data.size()), ec);

    if (ec == asio::error::would_block || ec == asio::error::try_again) {
        return 0;
    }
    if (ec) {
        return -1;
    }
    return static_cast<int>(n);
}

// ---------------------------------------------------------------------------
// recv
// ---------------------------------------------------------------------------

int TcpAsio::recv(SocketHandle s, etl::span<uint8_t> buf) {
    if (!valid(s)) return -1;
    auto& entry = entries_[static_cast<size_t>(s)];
    if (!entry.socket) return -1;

    asio::error_code ec;
    size_t n = entry.socket->read_some(asio::buffer(buf.data(), buf.size()), ec);

    if (ec == asio::error::would_block || ec == asio::error::try_again) {
        return 0;
    }
    if (ec == asio::error::eof) {
        return -1;
    }
    if (ec) {
        return -1;
    }
    return static_cast<int>(n);
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

void TcpAsio::close(SocketHandle s) {
    if (!valid(s)) return;
    auto& entry = entries_[static_cast<size_t>(s)];

    asio::error_code ec;
    if (entry.socket) {
        entry.socket->close(ec);
        entry.socket.reset();
    }
    if (entry.acceptor) {
        entry.acceptor->close(ec);
        entry.acceptor.reset();
    }

    entry.connecting = false;
    entry.connected = false;
    entry.closed = true;

    free_list_.push_back(s);
}

// ---------------------------------------------------------------------------
// remote_addr
// ---------------------------------------------------------------------------

bool TcpAsio::remote_addr(SocketHandle s, char* out_addr, size_t addr_max) {
    if (!valid(s) || addr_max == 0) return false;
    auto& entry = entries_[static_cast<size_t>(s)];
    if (!entry.socket) return false;

    asio::error_code ec;
    auto ep = entry.socket->remote_endpoint(ec);
    if (ec) return false;

    std::string addr_str = ep.address().to_string();
    if (addr_str.size() >= addr_max) return false;

    std::memcpy(out_addr, addr_str.c_str(), addr_str.size() + 1);
    return true;
}

} // namespace dataflou
