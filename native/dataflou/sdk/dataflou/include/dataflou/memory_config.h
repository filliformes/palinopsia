// memory_config.h — How a board sets the core's memory (memory.h), from the
// "memory" entry of a node's config, read before the node is created:
//
//   "memory": { "sketch_kb": 20, "reserve_kb": 48, "budget_kb": 0, "psram": "auto" }
//
// sketch_kb   what the sketch allocates after the node starts, at its peak:
//             added to the reserve (Device::reserve() in code)
// reserve_kb  heap left free for everything else (network stack, display,
//             sketch), checked against the real free heap at each
//             allocation; absent: the board's default
// budget_kb   at most this much for the core; 0 or absent: no cap
// psram       "auto" (use it if the board has some), "on", "off"
//
// Everything is optional: a firmware without it adapts to the RAM it finds.
#pragma once

#include <cstddef>
#include <cstdint>

namespace dataflou {

struct MemoryConfig {
    enum class Psram : uint8_t { Auto, On, Off };
    size_t sketch  = 0;          // added to the reserve
    size_t reserve = SIZE_MAX;   // SIZE_MAX: the board's default
    size_t budget  = 0;          // 0: none
    Psram  psram   = Psram::Auto;
};

// Reads the "memory" entry of a config (JSON). Missing or malformed fields
// keep their defaults. False only if the JSON itself does not parse.
bool read_memory_config(const char* json, MemoryConfig& out);

} // namespace dataflou
