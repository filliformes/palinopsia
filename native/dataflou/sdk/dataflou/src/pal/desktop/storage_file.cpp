#include "desktop/storage_file.h"
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

namespace dataflou {

StorageFile::StorageFile(const char* dir) : dir_(dir) {
    // Ensure trailing slash
    if (!dir_.empty() && dir_.back() != '/') {
        dir_ += '/';
    }
    // Create directory (and parents) if it doesn't exist
    std::error_code ec;
    std::filesystem::create_directories(dir_, ec);
}

void StorageFile::set_directory(const char* dir) {
    dir_ = dir;
    if (!dir_.empty() && dir_.back() != '/') {
        dir_ += '/';
    }
    std::error_code ec;
    std::filesystem::create_directories(dir_, ec);
}

std::string StorageFile::path_for(const char* key) const {
    return dir_ + key;
}

bool StorageFile::write(const char* key, etl::span<const uint8_t> data) {
    std::ofstream f(path_for(key), std::ios::binary);
    if (!f) return false;
    f.write(reinterpret_cast<const char*>(data.data()),
            static_cast<std::streamsize>(data.size()));
    return f.good();
}

bool StorageFile::read(const char* key, etl::span<uint8_t> buf, size_t& out_len) {
    std::ifstream f(path_for(key), std::ios::binary | std::ios::ate);
    if (!f) { out_len = 0; return false; }
    auto size = f.tellg();
    if (size < 0) { out_len = 0; return false; }
    out_len = static_cast<size_t>(size);
    if (out_len > buf.size()) out_len = buf.size();
    f.seekg(0);
    f.read(reinterpret_cast<char*>(buf.data()), static_cast<std::streamsize>(out_len));
    return f.good();
}

} // namespace dataflou
