#pragma once

#include "dataflou/node.h"

namespace dataflou {

using StatusCb = void(*)(const char* msg);

enum class DeviceState : uint8_t {
    Idle,           // Constructed, begin() not called
    StorageReady,   // PAL allocated; clock + storage available
    WaitingForLink, // Ethernet started, polling for PHY link
    WaitingForIP,   // Link up, waiting for DHCP
    Running,        // Node created, config loaded, mesh active
    Error           // Unrecoverable failure
};

inline const char* to_string(DeviceState s) {
    switch (s) {
        case DeviceState::Idle:           return "idle";
        case DeviceState::StorageReady:   return "storage-ready";
        case DeviceState::WaitingForLink: return "waiting-for-link";
        case DeviceState::WaitingForIP:   return "waiting-for-ip";
        case DeviceState::Running:        return "running";
        case DeviceState::Error:          return "error";
    }
    return "unknown";
}

using DeviceStateCb = void(*)(DeviceState old_state, DeviceState new_state, void* ctx);

class Device {
public:
    Device() = default;
#ifdef ARDUINO
    ~Device() = default;  // embedded: never exits, skip destructor chain
#else
    ~Device();
#endif

    Device(const Device&) = delete;
    Device& operator=(const Device&) = delete;

    /// What the sketch will allocate after begin() (buffers made on demand,
    /// libraries that allocate as they run), at its peak: kept free for it,
    /// on top of the board's reserve. Memory taken before begin() needs no
    /// mention (the core only sees what is free). Also "sketch_kb" in the
    /// config's "memory" entry. Call before begin().
    void reserve(size_t bytes) { sketch_reserve_ = bytes; }

    /// Start the boot sequence. Returns immediately.
    /// The core's memory is set when the node is created, from the config's
    /// "memory" entry and what the board has (see the platform's device
    /// file), unless the sketch set dataflou::Memory itself before.
    /// On embedded: advances to WaitingForLink; poll() drives the rest.
    /// On desktop: goes straight to Running.
    bool begin(const char* json_config, StatusCb status_cb = nullptr);

    /// Main loop tick — call every iteration.
    void poll();

    // --- State ---
    DeviceState state() const { return state_; }
    void on_state_changed(DeviceStateCb cb, void* ctx);

    // --- Param access (forwarded to Node) ---
    void              set_value(const char* path, const ParamValue& val);
    const ParamValue* get_value(const char* path) const;

    // --- Events (forwarded to Node) ---
    void on_peer_joined(Node::PeerCb cb, void* ctx);
    void on_peer_left(Node::PeerCb cb, void* ctx);
    void on_log(Node::LogCb cb, void* ctx);

    // --- Info ---
    uint16_t listen_port() const;
    const NodeIdentity& identity() const;
    const char* local_ip() const;
    uint64_t millis() const;

    // --- Platform resources (valid after begin()) ---
    IStorage* storage();

    // --- Advanced: direct Node access ---
    Node*       node()       { return node_; }
    const Node* node() const { return node_; }

private:
    struct Impl;
    Impl* impl_ = nullptr;
    Node* node_  = nullptr;

    DeviceState   state_      = DeviceState::Idle;
    const char*   config_     = nullptr;
    size_t        sketch_reserve_ = 0;
    StatusCb      status_cb_  = nullptr;
    DeviceStateCb state_cb_   = nullptr;
    void*         state_ctx_  = nullptr;

    // Deferred Node callbacks (registered before Node exists)
    Node::PeerCb  peer_joined_cb_  = nullptr;  void* peer_joined_ctx_ = nullptr;
    Node::PeerCb  peer_left_cb_    = nullptr;  void* peer_left_ctx_   = nullptr;
    Node::LogCb   log_cb_          = nullptr;  void* log_ctx_         = nullptr;

    void transition(DeviceState next);
};

} // namespace dataflou
