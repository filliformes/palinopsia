#pragma once
// fine_timer.h — sleeps to the millisecond. A Windows sleep lasts a system
// tick, 15.6 ms by default: a loop that polls every 2 ms would poll at 64 Hz.
// Held for the life of a process (or of what polls). Elsewhere: nothing.

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>   // before windows.h, always
#include <windows.h>
#include <timeapi.h>
#endif

namespace dataflou {

struct FineTimer {
#ifdef _WIN32
    FineTimer() {
        // Windows 11 ignores the period of a process whose window is hidden or
        // minimized, unless the process says it wants it all the same
        PROCESS_POWER_THROTTLING_STATE s{};
        s.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
        s.ControlMask = 0x4;   // PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION
        s.StateMask = 0;
        SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &s, sizeof s);
        timeBeginPeriod(1);
    }
    ~FineTimer() { timeEndPeriod(1); }
#else
    FineTimer() {}
#endif
    FineTimer(const FineTimer&) = delete;
    FineTimer& operator=(const FineTimer&) = delete;
};

} // namespace dataflou
