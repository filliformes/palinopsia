#pragma once

#include "dataflou/pal.h"
#include <chrono>

namespace dataflou {

class ClockStd : public IClock {
public:
    uint64_t millis() override {
        using namespace std::chrono;
        return duration_cast<milliseconds>(
            steady_clock::now().time_since_epoch()).count();
    }
};

} // namespace dataflou
