// state_json.h — a node's state as one JSON document: to move the node to
// another machine, or to replace a computer that broke (docs/api-hote.md,
// « L'état d'un nœud »).
//
//   { "dataflou_state": 1, "core": "9.1",
//     "identity": { "sku", "label", "product" }, "universe": "…",
//     "config": { … },          its declaration, as config_to_json writes it
//     "records": { "connections": "<base64>", "scenes": …, "scene_3": …,
//                  "phase": …, "decl": … },   the core's own storage records
//     "values": { "path": value, … } }        readable params, set by hand
//
// The records are the core's, as its storage keeps them (versioned there):
// a node made under the same sku, with them in its storage before it
// starts, is that node again, its connections, scenes and phase pin
// included, and declares past its old count. Write-only values are never
// in it; neither is what the node knows of others (its world view).
#pragma once

#include "dataflou/node.h"
#include <string>
#include <utility>
#include <vector>

namespace dataflou {

struct ExportedState {
    NodeIdentity identity;
    std::string universe;
    std::string config;     // JSON text, "" if none
    std::vector<std::pair<std::string, std::vector<uint8_t>>> records;
    std::vector<std::pair<std::string, std::string>> values;   // path, JSON text
};

// The node's state now (its records are written first). Free with json_free().
char* state_to_json(Node& node, IStorage& storage, bool pretty = true);

// Reads a state document; false with a reason if it isn't one.
bool state_from_json(const char* json, ExportedState& out, std::string& error);

// Writes its records into a node's storage: before that node starts, and
// only for the sku they belong to (the caller checks).
bool state_write_records(const ExportedState& state, IStorage& storage);

// Sets the state's values on the node's params that are there and readable
// (one path only, if given). Returns how many were set.
size_t state_apply_values(Node& node, const ExportedState& state, const char* only_path = nullptr);

// Its config with each of its values as its param's "value" (9.3: where a
// config load starts the param), for a node that keeps its config in a
// file and is made again from it ("" if the state has no config).
std::string state_config_with_values(const ExportedState& state);

} // namespace dataflou
