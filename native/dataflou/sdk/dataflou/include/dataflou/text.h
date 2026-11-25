// text.h — Text: a string that costs what it holds.
//
// Up to 15 characters live inside the object (16 bytes, on 32 and 64 bits):
// names, units, short labels and most values need no allocation. Longer text
// takes an exact-size block from the core's memory (memory.h), reused while
// it fits. Text in the model rarely changes (it is set when a param is
// declared), so this allocates on topology events like the rest.
//
// Out of memory, longer text keeps its first 15 characters: nothing in the
// core depends on a label or a description whole.
//
// The calls are etl::string's where the core uses them (c_str, size, empty,
// assign, compare, ==), so a field changes type without its users changing.
#pragma once

#include "dataflou/memory.h"
#include <etl/string.h>
#include <cstdint>
#include <cstring>

namespace dataflou {

class Text {
public:
    static constexpr size_t kInline = 15;
    static constexpr size_t kMax    = 65535;   // a sanity cap, not a size

    Text() { set_inline_len(0); inl_[0] = '\0'; }
    Text(const char* s) : Text() { assign(s); }
    Text(const char* s, size_t n) : Text() { assign(s, n); }
    template <size_t N>
    Text(const etl::string<N>& s) : Text() { assign(s.c_str(), s.size()); }
    Text(const etl::istring& s) : Text() { assign(s.c_str(), s.size()); }
    Text(const Text& o) : Text() { assign(o.c_str(), o.size()); }
    Text(Text&& o) noexcept { steal(o); }
    ~Text() { release(); }

    Text& operator=(const Text& o) { if (this != &o) assign(o.c_str(), o.size()); return *this; }
    Text& operator=(Text&& o) noexcept { if (this != &o) { release(); steal(o); } return *this; }
    Text& operator=(const char* s) { assign(s); return *this; }
    Text& operator=(const etl::istring& s) { assign(s.c_str(), s.size()); return *this; }

    const char* c_str() const { return on_heap() ? h_.ptr : inl_; }
    const char* data()  const { return c_str(); }
    size_t size()   const { return on_heap() ? h_.len : kInline - static_cast<uint8_t>(inl_[kInline]); }
    size_t length() const { return size(); }
    bool   empty()  const { return size() == 0; }
    // As etl::string: the most it may hold
    size_t max_size() const { return kMax; }

    bool assign(const char* s) { return assign(s, s ? std::strlen(s) : 0); }
    bool assign(const char* s, size_t n) {
        if (n > kMax) n = kMax;
        if (n <= kInline) {
            // s may point into our own heap block: copy before releasing
            char tmp[kInline + 1];
            if (n) std::memcpy(tmp, s, n);
            release();
            if (n) std::memcpy(inl_, tmp, n);
            inl_[n] = '\0';
            set_inline_len(n);
            return true;
        }
        if (on_heap() && n <= h_.cap) {             // fits the block it has
            std::memmove(h_.ptr, s, n);
            h_.ptr[n] = '\0';
            h_.len = static_cast<uint16_t>(n);
            return true;
        }
        char* p = static_cast<char*>(Memory::allocate(n + 1));
        if (!p) {                                   // keep what fits inline
            assign(s, kInline);
            return false;
        }
        std::memcpy(p, s, n);
        p[n] = '\0';
        release();
        h_.ptr = p;
        h_.len = static_cast<uint16_t>(n);
        h_.cap = static_cast<uint16_t>(n);
        inl_[kInline] = kHeap;
        return true;
    }
    void clear() { assign("", 0); }

    Text& operator+=(const char* s) {
        const size_t a = size(), b = s ? std::strlen(s) : 0;
        if (b == 0) return *this;
        char stackbuf[128];
        char* tmp = (a + b + 1 <= sizeof(stackbuf)) ? stackbuf
                  : static_cast<char*>(Memory::allocate(a + b + 1));
        if (!tmp) return *this;
        std::memcpy(tmp, c_str(), a);
        std::memcpy(tmp + a, s, b);
        assign(tmp, a + b);
        if (tmp != stackbuf) Memory::deallocate(tmp, a + b + 1);
        return *this;
    }

    int compare(const char* s) const { return std::strcmp(c_str(), s ? s : ""); }
    int compare(const Text& o) const { return std::strcmp(c_str(), o.c_str()); }

private:
    static constexpr uint8_t kHeap = 0x80;
    // Inline: the characters, and in the last byte (15 - length): a 15-char
    // text's terminator is that byte at 0. On the heap: the last byte is kHeap,
    // which the struct below never covers (12 bytes on 64 bits, 8 on 32).
    union {
        char inl_[kInline + 1];
        struct { char* ptr; uint16_t len; uint16_t cap; } h_;
    };
    bool on_heap() const { return static_cast<uint8_t>(inl_[kInline]) == kHeap; }
    void set_inline_len(size_t n) { inl_[kInline] = static_cast<char>(kInline - n); }
    void release() {
        if (on_heap()) {
            Memory::deallocate(h_.ptr, static_cast<size_t>(h_.cap) + 1);
            inl_[0] = '\0';
            set_inline_len(0);
        }
    }
    void steal(Text& o) {
        std::memcpy(static_cast<void*>(this), static_cast<const void*>(&o), sizeof(Text));
        o.inl_[0] = '\0';
        o.set_inline_len(0);
    }
};

static_assert(sizeof(Text) == 16, "Text is 16 bytes, on 32 and 64 bits");

inline bool operator==(const Text& a, const Text& b) { return a.size() == b.size() && a.compare(b) == 0; }
inline bool operator!=(const Text& a, const Text& b) { return !(a == b); }
inline bool operator==(const Text& a, const char* b) { return a.compare(b) == 0; }
inline bool operator!=(const Text& a, const char* b) { return !(a == b); }
inline bool operator==(const char* a, const Text& b) { return b.compare(a) == 0; }
inline bool operator!=(const char* a, const Text& b) { return !(b == a); }
inline bool operator==(const Text& a, const etl::istring& b) { return a.compare(b.c_str()) == 0; }
inline bool operator!=(const Text& a, const etl::istring& b) { return !(a == b); }
inline bool operator==(const etl::istring& a, const Text& b) { return b.compare(a.c_str()) == 0; }
inline bool operator!=(const etl::istring& a, const Text& b) { return !(b == a); }
inline bool operator<(const Text& a, const Text& b) { return a.compare(b) < 0; }

// "a/b" into out, whole ("b" when a is empty); false when out of memory,
// out then unchanged: a path is never kept shorter than it is.
inline bool path_join(const char* a, const char* b, Text& out) {
    const size_t na = a ? std::strlen(a) : 0, nb = b ? std::strlen(b) : 0;
    const size_t n = na + (na && nb ? 1 : 0) + nb;
    char stackbuf[128];
    char* tmp = n + 1 <= sizeof(stackbuf) ? stackbuf : static_cast<char*>(Memory::allocate(n + 1));
    if (!tmp) return false;
    if (na) std::memcpy(tmp, a, na);
    if (na && nb) tmp[na] = '/';
    if (nb) std::memcpy(tmp + n - nb, b, nb);
    Text t;
    const bool ok = t.assign(tmp, n);
    if (tmp != stackbuf) Memory::deallocate(tmp, n + 1);
    if (ok) out = static_cast<Text&&>(t);
    return ok;
}

} // namespace dataflou
