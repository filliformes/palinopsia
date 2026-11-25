// memory.h — The core's memory: one account, an optional budget, and the
// containers that draw on it.
//
// Every allocation the core makes goes through Memory, under two optional
// rules, both settable at any time:
//   budget  at most this many bytes for the core;
//   floor   leave at least this many bytes of the system heap free, read from
//           the heap itself at each allocation (the board says how: see
//           set_floor). It adapts to whatever RAM the board has.
// Without either, the core takes what the heap gives (desktop, iOS). When a
// rule says no, or the heap is out, an allocation fails: the core is built
// without exceptions, so the containers report it (false, nullptr, full())
// and the caller refuses with a reason instead of crashing.
//
// The core allocates on topology events (a param declared, a peer arriving,
// a connection made), not while streaming values: the hot path touches
// memory that already exists. See docs/embarque.md, "Mémoire".
//
// Vector<T>       grows as needed; elements move when it grows, so no
//                 pointer into it is kept across a push.
// StableVector<T> each element allocated on its own: its address holds until
//                 it is erased. For what the core points into (peers, world
//                 entries, params).
// Map<K, V>       a sorted Vector of pairs.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <utility>

namespace dataflou {

class Memory {
public:
    using AllocFn = void* (*)(size_t bytes);
    using FreeFn  = void  (*)(void* p);

    // 0: no budget (the default).
    static void   set_budget(size_t bytes) { budget_.store(bytes); }
    static size_t budget() { return budget_.load(); }
    static size_t used()   { return used_.load(); }
    static size_t peak()   { return peak_.load(); }
    // Allocations refused since start (budget reached or heap exhausted).
    static uint32_t refusals() { return refusals_.load(); }

    // Where the bytes come from (default malloc/free): e.g. PSRAM on an ESP32.
    static void set_allocator(AllocFn alloc, FreeFn free) { alloc_ = alloc; free_ = free; }

    // Keep `bytes` of the system heap free; `system_free` tells how much is
    // free in the heap the allocator draws from. 0 / nullptr: no floor.
    using SystemFreeFn = size_t (*)();
    static void set_floor(size_t bytes, SystemFreeFn system_free) {
        floor_.store(bytes);
        system_free_ = system_free;
    }
    static size_t floor() { return system_free_ ? floor_.load() : 0; }
    static size_t system_free() { return system_free_ ? system_free_() : SIZE_MAX; }

    // Would `bytes` more be allowed?
    static bool fits(size_t bytes) {
        const size_t b = budget_.load();
        if (b != 0 && used_.load() + bytes > b) return false;
        if (system_free_) {
            const size_t f = system_free_();
            if (f < floor_.load() + bytes) return false;
        }
        return true;
    }

    // Room left under both rules (SIZE_MAX without either).
    static size_t room() {
        size_t r = SIZE_MAX;
        const size_t b = budget_.load(), u = used_.load();
        if (b != 0) r = u >= b ? 0 : b - u;
        if (system_free_) {
            const size_t f = system_free_(), fl = floor_.load();
            const size_t heap_room = f > fl ? f - fl : 0;
            if (heap_room < r) r = heap_room;
        }
        return r;
    }

    static void* allocate(size_t bytes) {
        if (bytes == 0) bytes = 1;
        if (!fits(bytes)) { refusals_.fetch_add(1); return nullptr; }
        void* p = alloc_ ? alloc_(bytes) : std::malloc(bytes);
        if (!p) { refusals_.fetch_add(1); return nullptr; }
        const size_t now = used_.fetch_add(bytes) + bytes;
        size_t pk = peak_.load();
        while (now > pk && !peak_.compare_exchange_weak(pk, now)) {}
        return p;
    }

    static void deallocate(void* p, size_t bytes) {
        if (!p) return;
        if (bytes == 0) bytes = 1;
        if (free_) free_(p); else std::free(p);
        used_.fetch_sub(bytes);
    }

    // One object, constructed in place; nullptr if it doesn't fit.
    template <typename T, typename... Args>
    static T* create(Args&&... args) {
        void* p = allocate(sizeof(T));
        return p ? new (p) T(std::forward<Args>(args)...) : nullptr;
    }
    template <typename T>
    static void destroy(T* p) {
        if (!p) return;
        p->~T();
        deallocate(p, sizeof(T));
    }

private:
    static inline std::atomic<size_t>   budget_{0};
    static inline std::atomic<size_t>   used_{0};
    static inline std::atomic<size_t>   peak_{0};
    static inline std::atomic<uint32_t> refusals_{0};
    static inline std::atomic<size_t>   floor_{0};
    static inline SystemFreeFn system_free_ = nullptr;
    static inline AllocFn alloc_ = nullptr;
    static inline FreeFn  free_  = nullptr;
};

// ---------------------------------------------------------------------------

template <typename T>
class Vector {
public:
    using value_type     = T;
    using iterator       = T*;
    using const_iterator = const T*;

    Vector() = default;
    ~Vector() { release(); }

    Vector(const Vector& o) { copy_from(o); }
    Vector& operator=(const Vector& o) {
        if (this != &o) { clear(); copy_from(o); }
        return *this;
    }
    Vector(Vector&& o) noexcept : data_(o.data_), size_(o.size_), cap_(o.cap_) {
        o.data_ = nullptr; o.size_ = o.cap_ = 0;
    }
    Vector& operator=(Vector&& o) noexcept {
        if (this != &o) {
            release();
            data_ = o.data_; size_ = o.size_; cap_ = o.cap_;
            o.data_ = nullptr; o.size_ = o.cap_ = 0;
        }
        return *this;
    }

    size_t size() const     { return size_; }
    bool   empty() const    { return size_ == 0; }
    size_t capacity() const { return cap_; }
    // No room for one more, and the budget can't make any.
    bool   full() const     { return size_ == cap_ && !Memory::fits((cap_ + 1) * sizeof(T)); }
    // How many it could hold at most, given the budget left.
    size_t max_size() const {
        const size_t r = Memory::room();
        return r == SIZE_MAX ? SIZE_MAX / sizeof(T) : cap_ + r / sizeof(T);
    }

    T*       data()       { return data_; }
    const T* data() const { return data_; }
    iterator       begin()       { return data_; }
    iterator       end()         { return data_ + size_; }
    const_iterator begin() const { return data_; }
    const_iterator end()   const { return data_ + size_; }
    T&       operator[](size_t i)       { return data_[i]; }
    const T& operator[](size_t i) const { return data_[i]; }
    T&       front()       { return data_[0]; }
    const T& front() const { return data_[0]; }
    T&       back()        { return data_[size_ - 1]; }
    const T& back()  const { return data_[size_ - 1]; }

    bool reserve(size_t n) {
        if (n <= cap_) return true;
        T* fresh = static_cast<T*>(Memory::allocate(n * sizeof(T)));
        if (!fresh) return false;
        for (size_t i = 0; i < size_; ++i) {
            new (&fresh[i]) T(std::move(data_[i]));
            data_[i].~T();
        }
        Memory::deallocate(data_, cap_ * sizeof(T));
        data_ = fresh;
        cap_ = n;
        return true;
    }

    template <typename... Args>
    T* emplace_back(Args&&... args) {
        if (!grow_for(size_ + 1)) return nullptr;
        T* p = new (&data_[size_]) T(std::forward<Args>(args)...);
        ++size_;
        return p;
    }
    bool push_back(const T& v) { return emplace_back(v) != nullptr; }
    bool push_back(T&& v)      { return emplace_back(std::move(v)) != nullptr; }

    void pop_back() { if (size_) data_[--size_].~T(); }

    // nullptr if it doesn't fit
    iterator insert(const_iterator pos, const T& v) {
        const size_t at = static_cast<size_t>(pos - data_);
        T copy(v);                                  // v may live in this vector
        if (!grow_for(size_ + 1)) return nullptr;
        if (at == size_) { new (&data_[size_]) T(std::move(copy)); ++size_; return &data_[at]; }
        new (&data_[size_]) T(std::move(data_[size_ - 1]));
        for (size_t i = size_ - 1; i > at; --i) data_[i] = std::move(data_[i - 1]);
        data_[at] = std::move(copy);
        ++size_;
        return &data_[at];
    }

    iterator erase(const_iterator pos) { return erase(pos, pos + 1); }
    iterator erase(const_iterator first, const_iterator last) {
        const size_t a = static_cast<size_t>(first - data_);
        const size_t b = static_cast<size_t>(last - data_);
        if (a >= b) return data_ + a;
        const size_t n = b - a;
        for (size_t i = a; i + n < size_; ++i) data_[i] = std::move(data_[i + n]);
        for (size_t i = size_ - n; i < size_; ++i) data_[i].~T();
        size_ -= n;
        return data_ + a;
    }

    void clear() {
        for (size_t i = 0; i < size_; ++i) data_[i].~T();
        size_ = 0;
    }

    // Keeps the elements up to n, or adds default ones; false if it doesn't fit.
    bool resize(size_t n) {
        if (n < size_) { erase(data_ + n, data_ + size_); return true; }
        if (!grow_for(n)) return false;
        while (size_ < n) { new (&data_[size_]) T(); ++size_; }
        return true;
    }

    // Gives the memory back (clear() keeps it for the next fill).
    void shrink() { if (size_ == 0) release(); }

    bool operator==(const Vector& o) const {
        if (size_ != o.size_) return false;
        for (size_t i = 0; i < size_; ++i) if (!(data_[i] == o.data_[i])) return false;
        return true;
    }
    bool operator!=(const Vector& o) const { return !(*this == o); }

private:
    T*     data_ = nullptr;
    size_t size_ = 0;
    size_t cap_  = 0;

    bool grow_for(size_t n) {
        if (n <= cap_) return true;
#ifdef ARDUINO
        // By half on a board: while it grows, old and new blocks coexist
        size_t want = cap_ ? cap_ + cap_ / 2 + 1 : 4;
#else
        size_t want = cap_ ? cap_ * 2 : 4;
#endif
        if (want < n) want = n;
        // Short of budget for the doubling: take just what is needed
        if (!Memory::fits(want * sizeof(T))) want = n;
        return reserve(want);
    }
    void copy_from(const Vector& o) {
        if (!reserve(o.size_)) return;              // out of memory: stays empty
        for (size_t i = 0; i < o.size_; ++i) new (&data_[i]) T(o.data_[i]);
        size_ = o.size_;
    }
    void release() {
        clear();
        Memory::deallocate(data_, cap_ * sizeof(T));
        data_ = nullptr;
        cap_ = 0;
    }
};

// ---------------------------------------------------------------------------

template <typename T>
class StableVector {
public:
    using value_type = T;

    template <typename P, typename R>
    class Iter {
    public:
        explicit Iter(P* p = nullptr) : p_(p) {}
        R& operator*()  const { return **p_; }
        R* operator->() const { return *p_; }
        Iter& operator++() { ++p_; return *this; }
        Iter  operator++(int) { Iter t = *this; ++p_; return t; }
        Iter& operator--() { --p_; return *this; }
        Iter  operator+(ptrdiff_t n) const { return Iter(p_ + n); }
        Iter  operator-(ptrdiff_t n) const { return Iter(p_ - n); }
        ptrdiff_t operator-(const Iter& o) const { return p_ - o.p_; }
        bool operator==(const Iter& o) const { return p_ == o.p_; }
        bool operator!=(const Iter& o) const { return p_ != o.p_; }
        P* raw() const { return p_; }
    private:
        P* p_;
    };
    using iterator       = Iter<T*, T>;
    using const_iterator = Iter<T* const, const T>;

    StableVector() = default;
    ~StableVector() { clear(); }
    StableVector(const StableVector&) = delete;
    StableVector& operator=(const StableVector&) = delete;

    size_t size() const  { return items_.size(); }
    bool   empty() const { return items_.empty(); }
    bool   full() const  {
        return !Memory::fits(sizeof(T) + (items_.size() == items_.capacity() ? (items_.capacity() + 1) * sizeof(T*) : 0));
    }
    size_t max_size() const {
        const size_t r = Memory::room();
        return r == SIZE_MAX ? SIZE_MAX / sizeof(T) : items_.size() + r / (sizeof(T) + sizeof(T*));
    }

    iterator       begin()       { return iterator(items_.begin()); }
    iterator       end()         { return iterator(items_.end()); }
    const_iterator begin() const { return const_iterator(items_.begin()); }
    const_iterator end()   const { return const_iterator(items_.end()); }
    T&       operator[](size_t i)       { return *items_[i]; }
    const T& operator[](size_t i) const { return *items_[i]; }
    T&       back()        { return *items_.back(); }
    const T& back()  const { return *items_.back(); }

    template <typename... Args>
    T* emplace_back(Args&&... args) {
        T* p = Memory::create<T>(std::forward<Args>(args)...);
        if (!p) return nullptr;
        if (!items_.push_back(p)) { Memory::destroy(p); return nullptr; }
        return p;
    }
    bool push_back(const T& v) { return emplace_back(v) != nullptr; }
    bool push_back(T&& v)      { return emplace_back(std::move(v)) != nullptr; }

    iterator erase(iterator pos) {
        const size_t at = static_cast<size_t>(pos.raw() - items_.begin());
        Memory::destroy(items_[at]);
        items_.erase(items_.begin() + at);
        return iterator(items_.begin() + at);
    }

    void clear() {
        for (T* p : items_) Memory::destroy(p);
        items_.clear();
    }

private:
    Vector<T*> items_;
};

// ---------------------------------------------------------------------------

template <typename K, typename V>
struct MapEntry {
    K first;
    V second;
};

// Keys kept sorted (iteration in key order, as etl::map).
template <typename K, typename V>
class Map {
public:
    using value_type     = MapEntry<K, V>;
    using iterator       = value_type*;
    using const_iterator = const value_type*;

    size_t size() const  { return items_.size(); }
    bool   empty() const { return items_.empty(); }
    bool   full() const  { return items_.full(); }
    void   clear()       { items_.clear(); }

    iterator       begin()       { return items_.begin(); }
    iterator       end()         { return items_.end(); }
    const_iterator begin() const { return items_.begin(); }
    const_iterator end()   const { return items_.end(); }

    template <typename Key>
    iterator find(const Key& k) {
        iterator it = lower(k);
        return (it != end() && it->first == k) ? it : end();
    }
    template <typename Key>
    const_iterator find(const Key& k) const { return const_cast<Map*>(this)->find(k); }

    // Inserts or replaces; false if it doesn't fit.
    template <typename Key>
    bool set(const Key& k, const V& v) {
        iterator it = lower(k);
        if (it != end() && it->first == k) { it->second = v; return true; }
        value_type e{K(k), v};
        return items_.insert(it, e) != nullptr;
    }

    // As etl::map: inserts a default value if missing. Out of memory, the
    // value lands in a scratch slot that no lookup will find.
    template <typename Key>
    V& operator[](const Key& k) {
        iterator it = lower(k);
        if (it != end() && it->first == k) return it->second;
        value_type e{K(k), V{}};
        iterator at = items_.insert(it, e);
        if (at) return at->second;
        scratch_ = V{};
        return scratch_;
    }

    bool operator==(const Map& o) const {
        if (size() != o.size()) return false;
        for (size_t i = 0; i < size(); ++i)
            if (!(items_[i].first == o.items_[i].first) || !(items_[i].second == o.items_[i].second))
                return false;
        return true;
    }

private:
    Vector<value_type> items_;
    V scratch_{};

    template <typename Key>
    iterator lower(const Key& k) {
        size_t lo = 0, hi = items_.size();
        while (lo < hi) {
            const size_t mid = (lo + hi) / 2;
            if (items_[mid].first < k) lo = mid + 1; else hi = mid;
        }
        return items_.begin() + lo;
    }
};

} // namespace dataflou
