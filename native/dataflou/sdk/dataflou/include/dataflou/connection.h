// connection.h — a connection as its destination keeps it (9.1): the route
// between two ends, its links, and what each link does to a value.
//
// A connection joins a param or a group of the destination node to a param
// or a group of a source. Its links pair their params, one link per pair
// (`xy -> xy`, `size -> velocity`); a param-to-param connection has one link,
// both ends "". Links come from matching names, unless chosen by hand, and
// are made again whenever either tree changes. A link may carry a transform,
// which applies to every value (and every instance) the same.
//
// Between two populations (poly groups) the links pair the template's params
// ("xy", not "3/xy"); which slot an instance takes is the destination's
// allocation, never written down. docs/couches.md, "La connexion poly".
//
// A connection may also take one instance of a source population to a
// plain group or param (9.1): its source path has one "*" level
// (`touch/*`, `touch/*/xy`), and its pick says which instance stands
// there, by its id or by its rank among the live ones.
#pragma once

#include "dataflou/types.h"
#include "dataflou/memory.h"
#include <etl/span.h>

namespace dataflou {

// A curve through points, x and y in 0..1 (the normalized space of the
// link), x increasing: the first and last points are its ends. Fewer than
// two points: a straight line. Monotone unless free (a waveshaper).
static constexpr uint8_t CURVE_POINTS_MAX = 16;
struct Curve {
    uint8_t n = 0;
    float   x[CURVE_POINTS_MAX] = {};
    float   y[CURVE_POINTS_MAX] = {};
    bool    free = false;
    bool straight() const { return n < 2; }
    bool operator==(const Curve& o) const;
    bool operator!=(const Curve& o) const { return !(*this == o); }
};

// One component of a link's transform: the value, in the source's units,
// taken from `in` (default: the source's range) to 0..1, through the curve,
// then to `out` (default: the destination's range) in the destination's
// nature. Nothing set: what the plain mapping does.
struct LinkAxis {
    bool   in_set = false, out_set = false;
    double in_min = 0, in_max = 1;
    double out_min = 0, out_max = 1;
    Curve  curve;
    bool plain() const { return !in_set && !out_set && curve.straight(); }
    bool operator==(const LinkAxis& o) const;
    bool operator!=(const LinkAxis& o) const { return !(*this == o); }
};

struct Link {
    Text dest;              // relative to the connection's destination ("" for a param)
    Text source;            // relative to its source; empty when chosen: left unfed
    bool chosen = false;    // set by hand, not by matching names
    Vector<LinkAxis> axes;  // per component; none: straight
    bool plain() const;     // no transform
    bool operator==(const Link& o) const;
    bool operator!=(const Link& o) const { return !(*this == o); }
};

// Which instance of a source population feeds a connection whose source
// has a "*" level: the live one with that id (a population whose source
// gives meaningful ids: blob 3), or by rank, 1 the oldest live one, 2 the
// next, -1 the newest (a mono voice playing the last note held).
struct Pick {
    enum Kind : uint8_t { None, Id, Rank };
    Kind   kind  = None;
    double value = 0;              // the id, or the rank (never 0)
    bool any() const { return kind != None; }
    bool operator==(const Pick& o) const { return kind == o.kind && (kind == None || value == o.value); }
    bool operator!=(const Pick& o) const { return !(*this == o); }
};

struct Connection {
    ConnectionId    id;
    Text            dest;          // a param or a group of the destination node
    etl::string<36> source_sku;
    Text            source;        // a param or a group of the source
    bool            poly = false;  // between two populations (from the trees)
    Pick            pick;          // one instance of the source's "*" level
    Vector<Link>    links;         // what joins, as last made

    bool same_ends(const char* d, const char* sku, const char* s) const {
        return dest == d && source_sku == sku && source == s;
    }
    // The link of a destination param (relative to dest), or nullptr
    Link*       link_to(const char* rel);
    const Link* link_to(const char* rel) const;
    bool operator==(const Connection& o) const;
    bool operator!=(const Connection& o) const { return !(*this == o); }
};

using ConnectionList = Vector<Connection>;

// What an edit of a link changes (LINKEDIT, Node::edit_link)
enum LinkEdit : uint8_t {
    LinkSource    = 1 << 0,   // which source param feeds it (chosen by hand; "" none)
    LinkTransform = 1 << 1,   // its transform (axes; none: straight)
    LinkReset     = 1 << 2,   // back to matching names
};

// A curve's value at t (0..1)
float curve_at(const Curve& c, float t);

// The CBOR of a connection list, as storage keeps it (the record of a
// node's connections, a scene slot): {"f": 1, "v": version, "c": [...]},
// the same connections as CONNS carries. 0 if it doesn't fit.
size_t encode_connection_record(etl::span<uint8_t> buf, uint32_t version, const ConnectionList& list);
bool   decode_connection_record(etl::span<const uint8_t> data, uint32_t& version, ConnectionList& list);

// "a/b" + "c" -> "a/b/c"; either may be empty
void join_path(const char* a, const char* b, Text& out);

} // namespace dataflou
