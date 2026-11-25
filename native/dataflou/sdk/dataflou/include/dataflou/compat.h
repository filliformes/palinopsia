// compat.h — C++17/C++23 compatibility layer.
//
// Provides polyfills for std::expected/std::unexpected so the core
// library compiles on both C++23 (desktop) and C++17 (embedded GCC 8.4).
// On C++23, these are aliases to the standard types.
#pragma once

#if __cplusplus >= 202302L
#include <expected>
namespace dataflou {
    using std::expected;
    using std::unexpected;
}
#else
namespace dataflou {

template <typename E>
struct unexpected {
    E val_;
    explicit constexpr unexpected(E v) : val_(v) {}
    constexpr E error() const { return val_; }
};

template <typename T, typename E>
struct expected {
    bool ok_;
    E err_;

    constexpr expected() : ok_(true), err_{} {}
    constexpr expected(unexpected<E> u) : ok_(false), err_(u.error()) {}
    constexpr explicit operator bool() const { return ok_; }
    constexpr bool has_value() const { return ok_; }
    constexpr E error() const { return err_; }
};

} // namespace dataflou
#endif
