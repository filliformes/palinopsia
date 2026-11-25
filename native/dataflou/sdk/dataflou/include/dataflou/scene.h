// scene.h — Scenes: named sets of connections, kept by each node for itself.
//
// A node stores its own incoming connections (the subscriptions of its own
// destination params) in a numbered slot, and applies that slot on recall. The
// universe shares only the cue: "recall 3" (last writer wins, stamped with a
// Lamport counter + the sender's sku) travels to every node, and a node that
// joins later applies the current cue when it has that slot. "store 3" is a
// live cue: each node online saves its own connections. See docs/scenes.md.
#pragma once

#include "dataflou/config.h"
#include <cstdint>

#ifndef DATAFLOU_MAX_SCENES
#ifdef DATAFLOU_SLIM_WORLDVIEW
#define DATAFLOU_MAX_SCENES 8
#else
#define DATAFLOU_MAX_SCENES 16
#endif
#endif

static_assert(DATAFLOU_MAX_SCENES >= 1 && DATAFLOU_MAX_SCENES <= 32,
              "scene slots are a 32-bit mask in the declaration");

namespace dataflou {

// Slots are numbered 1..DATAFLOU_MAX_SCENES; 0 means none.

enum class SceneOp    : uint8_t { Recall, Store, Status };

// None:     no recall cue yet in this universe.
// Applied:  this node's connections are its slot of the current scene.
// Modified: connections changed since the recall (or the store).
// Missing:  this node has no slot for the current scene; it kept its
//           connections.
enum class SceneState : uint8_t { None, Applied, Modified, Missing };

inline const char* to_string(SceneState s) {
    switch (s) {
        case SceneState::None:     return "none";
        case SceneState::Applied:  return "applied";
        case SceneState::Modified: return "modified";
        case SceneState::Missing:  return "missing";
    }
    return "none";
}

inline const char* to_string(SceneOp op) {
    switch (op) {
        case SceneOp::Recall: return "recall";
        case SceneOp::Store:  return "store";
        case SceneOp::Status: return "status";
    }
    return "status";
}

// Order of cues: the later counter wins, the origin (hash of the sender's
// sku) breaks ties, so every node settles on the same cue. Counters compare
// as serial numbers (RFC 1982): the one up to 2^31 ahead is the later, so the
// clock wraps instead of sticking. A peer that sends 0xFFFFFFFF no longer
// silences every recall after it.
struct SceneStamp {
    uint32_t counter = 0;   // 0: no cue
    uint32_t origin  = 0;

    bool empty() const { return counter == 0; }
    // a is later than b, as serial numbers
    static bool later(uint32_t a, uint32_t b) {
        return static_cast<int32_t>(a - b) > 0;
    }
    bool newer_than(const SceneStamp& o) const {
        if (o.empty()) return !empty();
        if (empty()) return false;
        return counter != o.counter ? later(counter, o.counter) : origin > o.origin;
    }
    bool operator==(const SceneStamp& o) const {
        return counter == o.counter && origin == o.origin;
    }
};

// The universe's current cue, as each node knows it.
struct SceneCue {
    uint8_t    slot = 0;
    SceneStamp stamp;
};

// The two times of the work (docs/embarque.md, "Préparation et présentation"):
// preparation, where the mesh shows everything and every node calls every
// node; presentation, where only what carries values stays. A cue like a
// scene's: stamped, the latest wins, any node may set it.
enum class Phase : uint8_t { Preparation, Presentation };

inline const char* to_string(Phase p) {
    return p == Phase::Presentation ? "presentation" : "preparation";
}

struct PhaseCue {
    Phase      phase = Phase::Preparation;
    SceneStamp stamp;                    // empty: never set in this universe
};

// The mesh-wide stop (9.1), set by any node, the latest wins, carried like
// the phase: while on, every destination returns to its init and takes no
// value, every population's instances close.
struct HaltCue {
    bool       on = false;
    SceneStamp stamp;                    // empty: never set in this universe
};

// What a node says about itself in its declaration.
struct SceneStatus {
    uint8_t    current = 0;              // slot of the current cue (0: none)
    SceneState state   = SceneState::None;
    uint32_t   slots   = 0;              // bit n-1: this node has slot n
    uint8_t    skipped = 0;              // connections of the last recall it could not make
                                         // (its own param is gone)
    bool operator==(const SceneStatus& o) const {
        return current == o.current && state == o.state && slots == o.slots &&
               skipped == o.skipped;
    }
    bool operator!=(const SceneStatus& o) const { return !(*this == o); }
};

} // namespace dataflou
