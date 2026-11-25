// config.h — build settings by platform: what a build could pass as -D
// flags, for the builds that can't (the Arduino IDE has no per-library
// flags). A -D wins. Included first by types.h, so every header sees it.
#pragma once

#if defined(ARDUINO_ARCH_ESP32)
#  ifndef DATAFLOU_RECV_BUF_SIZE
#    define DATAFLOU_RECV_BUF_SIZE 10240
#  endif
#  ifndef DATAFLOU_MAX_MSG_BUF
#    define DATAFLOU_MAX_MSG_BUF 16384
#  endif
#  ifndef DATAFLOU_UDP_BUF_SIZE
#    define DATAFLOU_UDP_BUF_SIZE 1400
#  endif
#elif defined(ARDUINO_TEENSY41)
#  ifndef DATAFLOU_RECV_BUF_SIZE
#    define DATAFLOU_RECV_BUF_SIZE 8192
#  endif
#  ifndef DATAFLOU_MAX_MSG_BUF
#    define DATAFLOU_MAX_MSG_BUF 16384
#  endif
#  ifndef DATAFLOU_UDP_BUF_SIZE
#    define DATAFLOU_UDP_BUF_SIZE 1400
#  endif
#endif

// A microcontroller keeps the slim world view (no labels, units or
// descriptions of other nodes' params) unless told otherwise
#if defined(ARDUINO) && !defined(DATAFLOU_FULL_WORLDVIEW) && !defined(DATAFLOU_SLIM_WORLDVIEW)
#  define DATAFLOU_SLIM_WORLDVIEW
#endif
