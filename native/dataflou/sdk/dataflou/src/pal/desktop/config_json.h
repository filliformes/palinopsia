// config_json.h — Export a node's live declaration back to config JSON.
//
// The output uses the same schema config_loader reads (universe, identity,
// classes, params), so Node::load_json(config_to_json(node)) reproduces the
// declaration. Fields equal to their default (or to the inherited class value)
// are omitted. Values are not included: this is the schema, not the state.
#pragma once

#include "dataflou/node.h"
#include <string>
#include <vector>

namespace dataflou {

// Caller must free the returned string with json_free() (world_json.h).
char* config_to_json(const Node& node, bool pretty = true);

// Paths (groups and params, "a/b/c") declared by a config JSON document.
// Returns false if the JSON does not parse.
bool config_paths(const char* json, std::vector<std::string>& out);

// True if two config documents are structurally equal (key order ignored).
// Booleans compare equal to 1/0, since Max dictionaries store them as ints.
bool config_equal(const char* a, const char* b);

// Hot re-declare a running node from a full config document: params and groups
// absent from `json` are removed, the rest are (re)declared with their current
// values kept. sku and universe cannot change this way (mDNS, storage and peers
// are keyed on them); returns false with a reason in `error` instead.
bool apply_config(Node& node, const char* json, std::string& error);

} // namespace dataflou
