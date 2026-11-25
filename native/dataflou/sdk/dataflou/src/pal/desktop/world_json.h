#pragma once

#include "dataflou/world_view.h"
#include "dataflou/node.h"

struct cJSON;

namespace dataflou {

// Serialize the entire world view as a JSON snapshot message.
// Caller must free the returned string with json_free().
// Returns nullptr on error.
char* world_to_json(const WorldView& world);

// Same, plus each node's address/port (when this node has a direct link to it)
// and the host's own IPv4 addresses ("host_ips"), for the visualizer.
char* world_to_json(const Node& node);

// Serialize a peer_joined event.
char* peer_joined_to_json(const char* sku, const char* label);

// Serialize a peer_left event.
char* peer_left_to_json(const char* sku);

// A connection's id as the JSON says it ("<origin>-<counter>"); false if not one
bool connection_id_from_text(const char* s, ConnectionId& out);

// A "link_edit" from the visualizer: {"id", "dest" (the link), "source"?
// (feed it from that source param, "" none), "reset"? (back to names),
// "axes"? ([{"in": [min, max], "out": [min, max], "curve": [[x, y]…],
// "free": true}…], [] straight)}. The id, the link and what changes.
bool link_edit_from_json(const ::cJSON* root, ConnectionId& id, Link& link, uint8_t& what);

// A value as the snapshots say it (null: unknown), and back, read as a
// param of that type (core, config_loader.cpp: the config's own reading)
::cJSON* param_value_to_json(const ParamValue& v);
ParamValue value_from_json(const ::cJSON* item, ParamType type);
// The same for a param of that shape: an array's value is a JSON array of
// its elements (9.3), the first ones if fewer, the others at init (a
// config, a state)
ParamValue value_from_json(const ::cJSON* item, const ParamMetaCore& meta);
// The same for a set (the visualizer's set_value): a shorter list is an
// array of those elements alone, and the param set keeps the others
ParamValue value_for_set(const ::cJSON* item, const ParamMetaCore& meta);

// Free a string returned by the above functions.
void json_free(char* str);

} // namespace dataflou
