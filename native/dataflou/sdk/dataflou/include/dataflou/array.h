// array.h — arrays (core 9.3): a param of N values of one type.
//
// An array is declared "type": "array", "of" (its element type, ElemType)
// and "size" (N, fixed). Its range is one element's: range_min/max/init are
// of the element's scalar type (elem_scalar), the same for every element; a
// destination maps its values element by element, and a link's transform is
// shared by all of them (docs/couches.md, "Les tableaux (9.3)").
//
// In a ParamValue (tag Array) the element type is `of` and the elements are
// packed in `s`, elem_size() bytes each, in the host's byte order: float,
// int32_t, bool (one byte, 0 or 1), RGBA, uint8_t. The C API takes and
// gives them in that layout. On the wire (stream_codec.h) floats and ints
// are little-endian and bools are bits.
//
// One element is addressed by a path: "lights/3" is element 3 of the array
// "lights", counted from 1 as a population's slots are. A link may take
// one element alone into an ordinary param.
#pragma once

#include "dataflou/types.h"
#include "dataflou/memory.h"
#include <cmath>
#include <cstdint>
#include <cstring>

namespace dataflou {

// Bytes one element takes in a value (and in the C API)
constexpr size_t elem_size(ElemType t) {
    return t == ElemType::Bool || t == ElemType::Byte ? 1 : 4;
}

// The type one element reads as, alone: a number (float, int, byte), a
// bool, a colour. A range of an array is of this type.
constexpr ParamType elem_scalar(ElemType t) {
    return t == ElemType::Bool ? ParamType::Bool : t == ElemType::Colour ? ParamType::Colour
                                                                         : ParamType::Number;
}

constexpr bool known_elem(uint8_t t) { return t <= static_cast<uint8_t>(ElemType::Byte); }

// Bytes n elements take on the wire, the element type's byte aside (a bool
// is a bit)
constexpr size_t elem_wire_bytes(ElemType t, size_t n) {
    return t == ElemType::Bool ? (n + 7) / 8 : n * elem_size(t);
}

// An array's elements fit in one stream packet with room to spare (a
// packet is 1400 bytes): 256 floats, ints or colours, 1024 bytes, 8192
// bools. A larger one is refused at declaration.
constexpr size_t kMaxArrayBytes = 1024;

inline size_t max_array_size(ElemType t) {
    return t == ElemType::Bool ? kMaxArrayBytes * 8 : kMaxArrayBytes / elem_size(t);
}

inline bool valid_array(ElemType of, size_t n) {
    return known_elem(static_cast<uint8_t>(of)) && n >= 1 && n <= max_array_size(of);
}

// How many elements an array value holds (0 for any other value)
inline size_t array_count(const ParamValue& v) {
    return v.tag == ParamType::Array ? v.s.size() / elem_size(v.of) : 0;
}

inline const uint8_t* array_bytes(const ParamValue& v) {
    return reinterpret_cast<const uint8_t*>(v.s.c_str());
}

// Two arrays alike: the same element type and the same bytes (Text's ==
// stops at a zero byte)
inline bool array_same(const ParamValue& a, const ParamValue& b) {
    return a.of == b.of && a.s.size() == b.s.size() &&
           std::memcmp(a.s.c_str(), b.s.c_str(), a.s.size()) == 0;
}

// Element i as a value of its own (elem_scalar). False past the end.
inline bool array_get(const ParamValue& a, size_t i, ParamValue& out) {
    if (a.tag != ParamType::Array || i >= array_count(a)) return false;
    const uint8_t* p = array_bytes(a) + i * elem_size(a.of);
    out = ParamValue{};
    out.tag = elem_scalar(a.of);
    switch (a.of) {
    case ElemType::Float: { float f; std::memcpy(&f, p, 4); out.n = f; break; }
    case ElemType::Int:   { int32_t k; std::memcpy(&k, p, 4); out.n = k; break; }
    case ElemType::Bool:   out.b = *p != 0; break;
    case ElemType::Colour: std::memcpy(out.rgba, p, 4); break;
    case ElemType::Byte:   out.n = *p; break;
    }
    return true;
}

// Element i written from a value of the element's scalar type (a number
// rounds into an int and clamps into a byte). False past the end, or a
// value of another type (value_cast.h's array_set casts first).
inline bool array_put(ParamValue& a, size_t i, const ParamValue& x) {
    if (a.tag != ParamType::Array || i >= array_count(a) || x.tag != elem_scalar(a.of)) return false;
    uint8_t bytes[4] = {};
    switch (a.of) {
    case ElemType::Float: { const float f = static_cast<float>(x.n); std::memcpy(bytes, &f, 4); break; }
    case ElemType::Int: {
        const double r = std::round(x.n);
        const int32_t k = r >= 2147483647.0 ? INT32_MAX : r <= -2147483648.0 ? INT32_MIN
                                                                             : static_cast<int32_t>(r);
        std::memcpy(bytes, &k, 4);
        break;
    }
    case ElemType::Bool:   bytes[0] = x.b ? 1 : 0; break;
    case ElemType::Colour: std::memcpy(bytes, x.rgba, 4); break;
    case ElemType::Byte: {
        const double r = std::round(x.n);
        bytes[0] = r <= 0.0 ? 0 : r >= 255.0 ? 255 : static_cast<uint8_t>(r);
        break;
    }
    }
    // In place: the bytes are the Text's own
    std::memcpy(const_cast<char*>(a.s.c_str()) + i * elem_size(a.of), bytes, elem_size(a.of));
    return true;
}

// A new array of n elements, each `fill` (of the element's scalar type; any
// other: zero). False out of memory.
inline bool array_make(ParamValue& out, ElemType of, size_t n, const ParamValue& fill) {
    out = ParamValue{};
    out.tag = ParamType::Array;
    out.of = of;
    const size_t bytes = n * elem_size(of);
    char zero[64] = {};
    char* tmp = bytes <= sizeof(zero) ? zero : static_cast<char*>(Memory::allocate(bytes));
    if (!tmp) return false;
    if (tmp != zero) std::memset(tmp, 0, bytes);
    const bool ok = out.s.assign(tmp, bytes) && out.s.size() == bytes;
    if (tmp != zero) Memory::deallocate(tmp, bytes);
    if (!ok) { out.s.clear(); return false; }
    if (fill.tag == elem_scalar(of))
        for (size_t i = 0; i < n; ++i) array_put(out, i, fill);
    return true;
}

// A param's starting value: its init, every element of an array its init
inline ParamValue initial_value(const ParamMetaCore& m) {
    if (m.type == ParamType::Array) {
        ParamValue fill = m.range_init;
        fill.tag = elem_scalar(m.of);
        ParamValue out;
        if (!array_make(out, m.of, m.size, fill)) { out = ParamValue{}; out.tag = ParamType::Array; out.of = m.of; }
        return out;
    }
    ParamValue v = m.range_init;
    v.tag = m.type;
    return v;
}

// One element's shape, as a param of its own: the array's range and
// nature, the element's scalar type (what a link from or to one element
// maps through)
inline ParamMetaCore element_meta(const ParamMetaCore& array) {
    ParamMetaCore e;
    e.type = elem_scalar(array.of);
    e.mode = array.mode;
    e.flow = array.flow;
    e.access = array.access;
    e.nature = array.nature;
    e.topology = array.topology;
    e.rate = array.rate;
    e.range_min = array.range_min;
    e.range_max = array.range_max;
    e.range_init = array.range_init;
    e.range_min.tag = e.range_max.tag = e.range_init.tag = e.type;
    return e;
}

// "lights/3" -> the length of "lights" and index 2: a last segment of
// digits, 1 or more, under something. False for any other path.
inline bool split_element(const char* path, size_t& parent_len, size_t& index) {
    if (!path) return false;
    const char* slash = std::strrchr(path, '/');
    if (!slash || slash == path || !slash[1] || slash[1] == '0') return false;
    size_t k = 0;
    for (const char* p = slash + 1; *p; ++p) {
        if (*p < '0' || *p > '9' || k > 100000) return false;
        k = k * 10 + static_cast<size_t>(*p - '0');
    }
    parent_len = static_cast<size_t>(slash - path);
    index = k - 1;
    return true;
}

// The array param a path names one element of, and that element's index
// (from 0); nullptr when the path is not an element of an array there.
template <typename Store>
auto resolve_element(Store& store, const char* path, size_t& index) -> decltype(store.resolve(path)) {
    size_t parent_len = 0;
    if (!split_element(path, parent_len, index)) return nullptr;
    const Text parent(path, parent_len);
    auto* n = store.resolve(parent.c_str());
    if (!n || n->meta.kind != ParamKind::Param || n->meta.type != ParamType::Array ||
        index >= n->meta.size)
        return nullptr;
    return n;
}

} // namespace dataflou
