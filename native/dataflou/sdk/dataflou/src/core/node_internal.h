// node_internal.h — what the files of Node share (src/core/node*.cpp): the
// timings and the framing of a TCP message. Not part of the public headers.
#pragma once

#include "dataflou/node.h"
#include "dataflou/protocol.h"
#include "dataflou/value_cast.h"
#include "dataflou/version.h"
#include "stream_codec.h"
#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>
#if defined(ESP_PLATFORM)
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

namespace dataflou {

// One message on a peer's TCP connection: [4] length (BE), then the payload

static constexpr uint64_t DIGEST_INTERVAL_MS  = 10000; // 10s
static constexpr uint64_t UNIVERSE_SEEN_MS    = 45000; // a universe unheard of this long is gone
static constexpr uint64_t PERSIST_INTERVAL_MS = 5000;  // 5s
static constexpr uint64_t PEER_TIMEOUT_MS     = 30000; // 30s
static constexpr uint64_t CONNECT_TIMEOUT_MS  = 5000;  // outbound dial
static constexpr uint64_t HELLO_TIMEOUT_MS    = 10000; // a connection up, no HELLO yet
static constexpr size_t   MAX_MSG_BUF         = DATAFLOU_MAX_MSG_BUF;
// A length past this is a stream out of step, not a frame: disconnect. Frames
// up to it that don't fit recv_buf are skipped (see poll_tcp_peers).
static constexpr uint32_t MAX_SANE_FRAME      = 1u << 26;   // a length past this is garbage: the
                                                                   // connection goes (a frame past our
                                                                   // max_frame is only skipped)
static constexpr int      TCP_READS_PER_POLL  = 64;        // up to 64 KB from a peer in one poll
// What may wait for a peer that doesn't take what is sent: past it, the
// connection is closed (it comes back, and the digests repair what it missed)
static constexpr size_t   MAX_SEND_BACKLOG    = 2 * DATAFLOU_MAX_MSG_BUF > 65536 ? 2 * DATAFLOU_MAX_MSG_BUF : 65536;

} // namespace dataflou
