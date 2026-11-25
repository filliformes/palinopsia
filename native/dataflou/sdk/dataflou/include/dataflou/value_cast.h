// value_cast.h — Cross-type value conversion for the dataflou mesh.
//
// Provides centralized conversion between all numeric-like ParamTypes
// (Bool, Number, V2, V3, V4, Colour, and arrays of them). String and Blob
// are never castable. An array reads as its first element; a value into an
// array is cast element by element (cast_to, which knows the array's shape).
#pragma once

#include "dataflou/types.h"
#include "dataflou/array.h"
#include <algorithm>
#include <cmath>

namespace dataflou {

// Returns true if a meaningful conversion exists between two types.
inline bool can_cast(ParamType src, ParamType dst) {
    if (src == dst) return true;
    // Anything that arrives fires a trigger; a trigger has no value to give
    if (dst == ParamType::Trigger) return true;
    if (src == ParamType::Trigger) return false;
    // String and Blob are never castable to/from other types
    if (src == ParamType::String || src == ParamType::Blob) return false;
    if (dst == ParamType::String || dst == ParamType::Blob) return false;
    return true;
}

namespace detail {

inline uint8_t clamp_u8(double v) {
    if (v < 0.0) return 0;
    if (v > 255.0) return 255;
    return static_cast<uint8_t>(std::round(v));
}

inline float clamp01(float v) {
    if (v < 0.0f) return 0.0f;
    if (v > 1.0f) return 1.0f;
    return v;
}

inline double to_number(const ParamValue& src) {
    switch (src.tag) {
    case ParamType::Bool:   return src.b ? 1.0 : 0.0;
    case ParamType::Number: return src.n;
    case ParamType::V2:     return static_cast<double>(src.v2[0]);
    case ParamType::V3:     return static_cast<double>(src.v3[0]);
    case ParamType::V4:     return static_cast<double>(src.v4[0]);
    case ParamType::Colour: return static_cast<double>(src.rgba[0]) / 255.0;
    default: return 0.0;
    }
}

inline bool to_bool(const ParamValue& src) {
    switch (src.tag) {
    case ParamType::Bool:   return src.b;
    case ParamType::Number: return src.n != 0.0;
    case ParamType::V2:     return src.v2[0] != 0.0f || src.v2[1] != 0.0f;
    case ParamType::V3:     return src.v3[0] != 0.0f || src.v3[1] != 0.0f || src.v3[2] != 0.0f;
    case ParamType::V4:     return src.v4[0] != 0.0f || src.v4[1] != 0.0f || src.v4[2] != 0.0f || src.v4[3] != 0.0f;
    case ParamType::Colour: return src.rgba[0] != 0 || src.rgba[1] != 0 || src.rgba[2] != 0 || src.rgba[3] != 0;
    default: return false;
    }
}

// Fill float array from source, returning up to 4 components.
// Components are 0.0-1.0 for Colour, raw for others.
inline void to_floats(const ParamValue& src, float out[4], int& count) {
    switch (src.tag) {
    case ParamType::Bool: {
        float v = src.b ? 1.0f : 0.0f;
        out[0] = out[1] = out[2] = out[3] = v;
        count = 1;
        break;
    }
    case ParamType::Number: {
        float v = static_cast<float>(src.n);
        out[0] = out[1] = out[2] = out[3] = v;
        count = 1;
        break;
    }
    case ParamType::V2:
        out[0] = src.v2[0]; out[1] = src.v2[1]; out[2] = 0.0f; out[3] = 0.0f;
        count = 2;
        break;
    case ParamType::V3:
        out[0] = src.v3[0]; out[1] = src.v3[1]; out[2] = src.v3[2]; out[3] = 0.0f;
        count = 3;
        break;
    case ParamType::V4:
        out[0] = src.v4[0]; out[1] = src.v4[1]; out[2] = src.v4[2]; out[3] = src.v4[3];
        count = 4;
        break;
    case ParamType::Colour:
        out[0] = static_cast<float>(src.rgba[0]) / 255.0f;
        out[1] = static_cast<float>(src.rgba[1]) / 255.0f;
        out[2] = static_cast<float>(src.rgba[2]) / 255.0f;
        out[3] = static_cast<float>(src.rgba[3]) / 255.0f;
        count = 4;
        break;
    default:
        out[0] = out[1] = out[2] = out[3] = 0.0f;
        count = 0;
        break;
    }
}

} // namespace detail

// Returns true if conversion succeeded. Writes result to `out`.
inline bool value_cast(const ParamValue& src, ParamType dst_type, ParamValue& out) {
    if (src.tag == ParamType::Array && dst_type != ParamType::Array && !src.unknown) {
        // An array to one value: its first element (as a vector's first component)
        if (dst_type == ParamType::Trigger) { out = ParamValue{}; out.tag = dst_type; return true; }
        ParamValue first;
        if (!array_get(src, 0, first)) return false;
        return value_cast(first, dst_type, out);
    }
    // Into an array: only from one (its shape is the param's: cast_to)
    if (dst_type == ParamType::Array && src.tag != ParamType::Array && !src.unknown) return false;
    if (src.unknown) {                       // unknown stays unknown, in any type
        out = ParamValue{};
        out.tag = dst_type;
        out.unknown = true;
        return true;
    }
    if (src.tag == dst_type) {
        out = src;
        return true;
    }
    if (!can_cast(src.tag, dst_type)) return false;

    out.tag = dst_type;
    out.s.clear();
    if (dst_type == ParamType::Trigger) { out.n = 0; return true; }

    float f[4];
    int fc;
    detail::to_floats(src, f, fc);

    switch (dst_type) {
    case ParamType::Bool:
        out.b = detail::to_bool(src);
        break;
    case ParamType::Number:
        out.n = detail::to_number(src);
        break;
    case ParamType::V2:
        out.v2[0] = f[0];
        out.v2[1] = (fc >= 2) ? f[1] : f[0];
        break;
    case ParamType::V3:
        out.v3[0] = f[0];
        out.v3[1] = (fc >= 2) ? f[1] : f[0];
        out.v3[2] = (fc >= 3) ? f[2] : ((fc == 1) ? f[0] : 0.0f);
        break;
    case ParamType::V4:
        out.v4[0] = f[0];
        out.v4[1] = (fc >= 2) ? f[1] : f[0];
        out.v4[2] = (fc >= 3) ? f[2] : ((fc == 1) ? f[0] : 0.0f);
        out.v4[3] = (fc >= 4) ? f[3] : ((fc == 1) ? f[0] : 0.0f);
        break;
    case ParamType::Colour:
        // For Colour, input floats are expected 0-1 range (clamped).
        // Exception: Bool false→black, true→white
        if (src.tag == ParamType::Bool) {
            uint8_t v = src.b ? 255 : 0;
            out.rgba[0] = v; out.rgba[1] = v; out.rgba[2] = v; out.rgba[3] = 255;
        } else {
            // fc==1 means single-component fill (Number/Bool): use f[0] for R,G,B
            out.rgba[0] = detail::clamp_u8(static_cast<double>(detail::clamp01(f[0])) * 255.0);
            out.rgba[1] = detail::clamp_u8(static_cast<double>(detail::clamp01(f[1])) * 255.0);
            out.rgba[2] = detail::clamp_u8(static_cast<double>(detail::clamp01((fc >= 3) ? f[2] : f[0])) * 255.0);
            out.rgba[3] = detail::clamp_u8(static_cast<double>(detail::clamp01((fc >= 4) ? f[3] : 1.0f)) * 255.0);
        }
        break;
    default:
        return false;
    }

    return true;
}

// Element i of an array written from any value castable to its elements
inline bool array_set(ParamValue& a, size_t i, const ParamValue& v) {
    if (a.tag != ParamType::Array) return false;
    ParamValue x;
    if (!value_cast(v, elem_scalar(a.of), x) || x.unknown) return false;
    return array_put(a, i, x);
}

// Any value into a param of shape `m`: value_cast, and for an array, element
// by element. Into an array, an array gives its elements in order (its
// first ones, or the first of the param's, the others kept from `base`,
// else from the init); one value fills every element. False if it can't.
inline bool cast_to(const ParamValue& src, const ParamMetaCore& m, ParamValue& out,
                    const ParamValue* base = nullptr) {
    if (m.type != ParamType::Array) return value_cast(src, m.type, out);
    if (src.unknown) {
        out = ParamValue{};
        out.tag = ParamType::Array;
        out.of = m.of;
        out.unknown = true;
        return true;
    }
    if (src.tag == ParamType::Array && src.of == m.of && array_count(src) == m.size) {
        out = src;
        return true;
    }
    if (src.tag == ParamType::String || src.tag == ParamType::Blob || src.tag == ParamType::Trigger)
        return false;
    ParamValue a;
    if (base && base->tag == ParamType::Array && base->of == m.of && array_count(*base) == m.size &&
        !base->unknown)
        a = *base;
    else
        a = initial_value(m);
    if (array_count(a) != m.size) return false;          // out of memory
    if (src.tag == ParamType::Array) {
        const size_t n = std::min(array_count(src), static_cast<size_t>(m.size));
        ParamValue x;
        for (size_t i = 0; i < n; ++i)
            if (array_get(src, i, x)) array_set(a, i, x);
    } else {
        ParamValue x;
        if (!value_cast(src, elem_scalar(m.of), x)) return false;
        for (size_t i = 0; i < m.size; ++i) array_put(a, i, x);
    }
    out = a;
    return true;
}

} // namespace dataflou
