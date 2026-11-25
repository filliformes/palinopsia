#include "dataflou/memory_config.h"
#include <cJSON.h>
#include <cstring>

namespace dataflou {

bool read_memory_config(const char* json, MemoryConfig& out) {
    cJSON* root = json ? cJSON_Parse(json) : nullptr;
    if (!root) return false;
    const cJSON* mem = cJSON_GetObjectItem(root, "memory");
    if (cJSON_IsObject(mem)) {
        const cJSON* k = cJSON_GetObjectItem(mem, "sketch_kb");
        if (cJSON_IsNumber(k) && k->valuedouble >= 0)
            out.sketch = static_cast<size_t>(k->valuedouble) * 1024;
        const cJSON* r = cJSON_GetObjectItem(mem, "reserve_kb");
        if (cJSON_IsNumber(r) && r->valuedouble >= 0)
            out.reserve = static_cast<size_t>(r->valuedouble) * 1024;
        const cJSON* b = cJSON_GetObjectItem(mem, "budget_kb");
        if (cJSON_IsNumber(b) && b->valuedouble >= 0)
            out.budget = static_cast<size_t>(b->valuedouble) * 1024;
        const cJSON* p = cJSON_GetObjectItem(mem, "psram");
        if (cJSON_IsString(p)) {
            if (std::strcmp(p->valuestring, "on") == 0) out.psram = MemoryConfig::Psram::On;
            else if (std::strcmp(p->valuestring, "off") == 0) out.psram = MemoryConfig::Psram::Off;
            else out.psram = MemoryConfig::Psram::Auto;
        }
    }
    cJSON_Delete(root);
    return true;
}

} // namespace dataflou
