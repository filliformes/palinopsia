#pragma once

#include "dataflou/pal.h"
#include <etl/string.h>

namespace dataflou {

class StorageFile : public IStorage {
public:
    // dir: directory to store files in (e.g., "~/.dataflou/")
    explicit StorageFile(const char* dir);

    void set_directory(const char* dir);

    bool write(const char* key, etl::span<const uint8_t> data) override;
    bool read(const char* key, etl::span<uint8_t> buf, size_t& out_len) override;

private:
    std::string dir_;
    std::string path_for(const char* key) const;
};

} // namespace dataflou
