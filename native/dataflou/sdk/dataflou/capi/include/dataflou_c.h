/* dataflou_c.h — the dataflou node behind a plain C interface: the host API
 * every language binds (Swift today; Python, a C++ wrapper, Godot…). See
 * docs/api-hote.md.
 *
 * API 0.x: it may still change, never silently. Additions are free; a
 * break raises the minor and says what to change (capi/api.txt records the
 * declarations of the current version, capi/check_api.py checks them).
 * Structs that may grow carry their size: set `size = sizeof(...)`.
 * df_value keeps its layout for good; what doesn't fit in it (long text,
 * future types) comes through functions of its own.
 *
 * For hosts that cannot use the C++ core directly (Swift first). One df_node
 * is one node on the mesh: its sockets, its Bonjour presence, its storage.
 *
 * Threading: like the core, a df_node belongs to one thread. Every function
 * that takes a df_node must be called from the thread that calls
 * df_node_poll(). Callbacks run on that thread, inside df_node_poll().
 *
 * Strings are UTF-8, NUL-terminated. Paths are slash-separated ("pad/xy").
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DF_API_VERSION_MAJOR 0
#define DF_API_VERSION_MINOR 6

typedef struct df_node df_node;

/* The API version this library implements. */
void df_api_version(int* major, int* minor);

/* What this library can do, by name: "declare", "watch", "world_json",
 * "monitor", "scenes", "phase", "seeds", "forget", "link_stats", "clock",
 * "trigger", "text", "groups", "destinations", "populations", "samples",
 * "unknown", "locate", "halt", "ids", "sources", "listeners", "shaping",
 * "merge", "arrays", "timed", "read_only" (and those said where they come). An unknown
 * name: false. */
bool df_has_feature(const char* name);

typedef enum {
    DF_BOOL = 0, DF_NUMBER, DF_STRING, DF_V2, DF_V3, DF_V4, DF_BLOB, DF_COLOUR,
    DF_TRIGGER,  /* an event, no value (core 9.0) */
    DF_UNKNOWN,  /* (core 9.1) a value: none is known (null), not absent; to
                    set a param unknown, df_set() a value of this type */
    DF_ARRAY     /* (API 0.6, core 9.3) N values of one type (df_elem): in a
                    df_value, n is how many; its elements through df_get_array() */
} df_type;

/* An array's elements (API 0.6, core 9.3), and how the functions that take
 * or give them lay them out: float (float), int (int32_t), bool (bool, one
 * byte), colour (4 bytes R, G, B, A), byte (uint8_t, 0..255: a DMX channel). */
typedef enum { DF_ELEM_FLOAT = 0, DF_ELEM_INT, DF_ELEM_BOOL, DF_ELEM_COLOUR, DF_ELEM_BYTE } df_elem;

typedef enum { DF_SOURCE = 0, DF_DESTINATION, DF_BIDIR } df_flow;

/* A value of any type: read the member its type says.
 * number: n. bool: b. v2/v3/v4: v. colour: rgba. string: s.
 * trigger: n, how many times it fired here. array: n, how many elements
 * (one element, df_get_element: its own type, number, bool or colour). */
typedef struct {
    df_type type;
    bool    b;
    double  n;
    float   v[4];
    uint8_t rgba[4];
    char    s[129];
} df_value;

typedef struct {
    uint32_t    size;        /* sizeof(df_config) */
    const char* name;        /* the node's label on the mesh */
    const char* sku;         /* its identity: a UUID, see df_sku_from_seed() */
    const char* product;     /* what kind of node this is, e.g. "dataflou iOS" */
    const char* universe;    /* NULL or "": "default" */
    const char* storage_dir; /* a folder this node may write to; created if missing */
    const char* interface;   /* NULL or "": every interface; else e.g. "en0" */
} df_config;

/* The core's version, "9.0". */
const char* df_core_version(void);

/* A stable UUID (v5) for a seed string: the same seed gives the same sku. */
void df_sku_from_seed(const char* seed, char out[37]);

df_node* df_node_create(const df_config* config);
void     df_node_destroy(df_node* node);

/* Declares the node's params from a dataflou JSON config ({"params": [...]}).
 * The identity and universe given at creation win over the config's.
 * Before df_node_start(). */
bool df_node_load_json(df_node* node, const char* json);

bool df_node_start(df_node* node);
void df_node_stop(df_node* node);
void df_node_poll(df_node* node);

const char* df_node_sku(const df_node* node);
uint16_t    df_node_port(const df_node* node);   /* 0 until started */

/* What the Bonjour backend last said: "ok", or why it cannot browse
 * (e.g. "local network access denied"). */
const char* df_node_discovery_status(const df_node* node);

typedef void (*df_log_fn)(const char* line, void* context);
void df_node_on_log(df_node* node, df_log_fn fn, void* context);

/* --- this node's params --- */

bool df_set_bool(df_node* node, const char* path, bool value);
bool df_set_number(df_node* node, const char* path, double value);
bool df_set_vector(df_node* node, const char* path, const float* v, int count); /* 2..4 */
bool df_set_colour(df_node* node, const char* path, uint8_t r, uint8_t g, uint8_t b, uint8_t a);
bool df_set_string(df_node* node, const char* path, const char* value);
bool df_fire(df_node* node, const char* path);   /* a trigger param fires */
bool df_get(const df_node* node, const char* path, df_value* out);

/* A text or blob param's whole value (df_value holds its first 128 bytes):
 * writes up to `capacity` bytes, NUL-terminated, and returns its full length
 * (a blob's bytes may hold NULs: take the length); -1 if there is no such
 * text or blob param. */
long df_get_text(const df_node* node, const char* path, char* out, size_t capacity);

/* --- the world: every node this one knows, itself included --- */

typedef struct {
    char sku[37];
    char label[33];
    char product[33];
    bool online;
    bool local;      /* this node */
} df_world_node;

typedef struct {
    char     path[129];
    char     label[33];
    char     unit[9];
    int      depth;          /* 0 for top-level entries */
    bool     is_group;
    int      slots;          /* a poly group: how many slots (its children); else 0 */
    df_type  type;
    df_flow  flow;
    df_value value;
    df_value min;
    df_value max;
    uint32_t epoch;          /* goes up each time the value is written */
    int      connections;    /* sources this destination listens to */
} df_world_param;

size_t df_world_node_count(const df_node* node);
bool   df_world_node_at(const df_node* node, size_t index, df_world_node* out);

/* A node's params, depth first, groups before their children. Writes up to
 * `capacity` entries and returns how many the node has. */
size_t df_world_params(const df_node* node, const char* sku,
                       df_world_param* out, size_t capacity);

/* --- connections: a destination listens to a source --- */

/* On this node: local_path listens to source_sku's source_path. */
bool df_connect(df_node* node, const char* local_path,
                const char* source_sku, const char* source_path);
bool df_disconnect(df_node* node, const char* local_path,
                   const char* source_sku, const char* source_path);

/* On any node: ask dest_sku to connect (or drop) its dest_path. */
bool df_connect_remote(df_node* node, const char* dest_sku, const char* dest_path,
                       const char* source_sku, const char* source_path);
bool df_disconnect_remote(df_node* node, const char* dest_sku, const char* dest_path,
                          const char* source_sku, const char* source_path);

/* Set a value on another node (refused on a param declared `read`: see
 * df_set_remote). */
bool df_set_remote_number(df_node* node, const char* sku, const char* path, double value);

/* --- since core 9.0 (the Swift package) --- */

/* A param's part in a population's template (core 9.1): the gate (a bool:
 * an instance is open while it is on), the id (a number: which instance),
 * commit (a bool: the opening is tentative until it rises), reason (a text
 * or a df_end_reason number, read as the gate falls), attack and release
 * (the values its open and its release carry), key (re-identification),
 * parent (the id of the instance it belongs to), confidence (0..1).
 * NONE: by its name, a bool "on" is the gate and "id" the id. An open set. */
typedef enum { DF_ROLE_NONE, DF_ROLE_GATE, DF_ROLE_ID, DF_ROLE_COMMIT, DF_ROLE_REASON,
               DF_ROLE_ATTACK, DF_ROLE_RELEASE, DF_ROLE_KEY, DF_ROLE_PARENT, DF_ROLE_CONFIDENCE } df_role;

/* How a destination combines what several connections feed it (core 9.3,
 * API 0.6, feature "merge"): the last value wins (LTP, the default, as
 * before), the highest (HTP: per channel for a colour, OR for a bool), or
 * the average (AVG: per channel; per component for a vector; a bool is on
 * when any is). Numbers, colours, bools and arrays; vectors average (HTP on
 * a vector is LTP); any other type is LTP. A source lost leaves the merge
 * after the destination's grace (one second). */
typedef enum { DF_MERGE_LTP, DF_MERGE_HTP, DF_MERGE_AVG } df_merge;

/* A param of this node, declared or declared again with these settings
 * (groups on its path are made). The value fields of min/max/init are read
 * by `type`; has_range / has_init say whether they are set. */
typedef struct {
    uint32_t    size;           /* sizeof(df_param_settings) */
    df_type     type;
    df_flow     flow;
    bool        streaming;      /* sent continuously at `rate`; else on change */
    double      rate;           /* Hz, 0: unlimited */
    const char* label;
    const char* unit;
    const char* desc;
    bool        has_range;
    df_value    min, max;
    bool        has_init;
    df_value    init;
    double      ground_up, ground_down;   /* s back to init when no longer fed; <0: stays */
    /* since core 9.1 (feature "populations"); a smaller struct leaves them unset */
    df_role     role;           /* in a population's template: its gate, its id */
    bool        every_sample;   /* every value written counts, not only the last (a
                                   stream): sent and delivered in order */
    /* since C API 0.3 (feature "write_only") */
    bool        write_only;     /* a destination whose value never leaves this node (a
                                   password, a command): set by the mesh, never
                                   streamed, declared or shown; ignored on a source */
    /* since C API 0.6 (feature "merge") */
    df_merge    merge;          /* a destination fed by several connections: how it
                                   combines them (LTP, the default: the last wins) */
    /* since API 0.6 (feature "arrays"): type DF_ARRAY, `count` values of type
       `of`; min, max and init are one element's (a number, a bool, a
       colour), the same for every element. 1 to 256 floats, ints or
       colours, 1024 bytes, 8192 bools (a stream packet's room). */
    df_elem     of;
    int         count;
    /* since API 0.6 (feature "read_only"): declared `read`, as a config's
       "access": "read" says: only this node sets it, the mesh observes it
       (df_set_remote* of it refused, by a peer or here). false, the
       default: readwrite, a source too. Not with write_only (refused). */
    bool        read_only;
} df_param_settings;
bool df_declare(df_node* node, const char* path, const df_param_settings* settings);

/* Every slot of a population taken, a new instance: the oldest gives way
 * (STEAL), it is refused (REFUSE), or the newest gives way (NEWEST). One in
 * release gives way first. */
typedef enum { DF_FULL_STEAL, DF_FULL_REFUSE, DF_FULL_NEWEST } df_full;
/* Who gives a population's instances their id (core 9.1): the core, a
 * counter per population (AUTO: notes, touches), or the source, whose ids
 * mean something and are required (SOURCE: blob tracking). */
typedef enum { DF_IDS_AUTO, DF_IDS_SOURCE } df_ids;

/* A group of this node, declared or declared again (groups on its path are
 * made). With slots > 0 it is a poly group: a population of `slots` slots,
 * the groups 1 … slots under it, all alike (declare each slot's params,
 * path/1/x … path/N/x). Feature "groups". */
typedef struct {
    uint32_t    size;           /* sizeof(df_group_settings) */
    const char* label;
    const char* desc;
    int         slots;          /* 0: an ordinary group; 1 … 255: a poly group */
    /* since core 9.1 (feature "populations"); a smaller struct: their defaults */
    df_full     full;           /* every slot taken: which instance gives way
                                   (one in release first), or none */
    int         grace_ms;           /* a lost source's instances wait (0: 250) */
    double      hold;               /* 0: a release closes at once; > 0: the slot is
                                       held this many s; < 0: held until df_close() */
    df_ids      ids;                /* who gives its instances their id (feature "ids") */
} df_group_settings;
bool df_declare_group(df_node* node, const char* path, const df_group_settings* settings);

/* Since API 0.4 (feature "remove"): a param or a group of this node, and
 * all under it, removed (a plug-in instance gone, a box deleted); the node
 * declares again. False if there is no such path. */
bool df_remove(df_node* node, const char* path);

/* Any value, cast to the param's type. df_set_remote*: a param declared
 * `read` (df_param_settings.read_only, a config's "access": "read", an
 * adapter's status) is not set, by its
 * node (a peer's) or here (this node's: false); one declared here is
 * readwrite, a source too (core 9.2). */
bool df_set(df_node* node, const char* path, const df_value* value);
bool df_set_remote(df_node* node, const char* sku, const char* path, const df_value* value);
/* Since API 0.3: a text (DF_STRING) or a blob (DF_BLOB) of any length and any
 * bytes, which a df_value can't hold; cast to the param's type. Read one back
 * whole with df_get_text(). */
bool df_set_bytes(df_node* node, const char* path, df_type type, const void* data, size_t len);
bool df_set_remote_bytes(df_node* node, const char* sku, const char* path, df_type type,
                         const void* data, size_t len);

/* Changes of this node's params that did not come from this node (the mesh,
 * a connection): fn(path, value) inside df_node_poll(); for a param whose
 * every sample counts, each of them, in order. */
typedef void (*df_change_fn)(const char* path, const df_value* value, void* context);
bool df_watch(df_node* node, const char* path);
void df_node_on_change(df_node* node, df_change_fn fn, void* context);

/* Nodes coming and going: fn(joined, sku, label). */
typedef void (*df_peer_fn)(bool joined, const char* sku, const char* label, void* context);
void df_node_on_peer(df_node* node, df_peer_fn fn, void* context);

/* How this node's destinations stand (feature "destinations"): what the
 * status outlet of a Max data.* object says.
 *
 * Both sets are open: a later API minor may refine them (add a state, an
 * origin) and grow df_destination. A host only ever gets the values of the
 * header it was built with: the struct's size says which header that is (a
 * new value always comes with a new field), and a value the host doesn't know
 * is given as the one it refines. So an old host keeps working, coarser. */
typedef enum {
    DF_DEST_FREE,           /* nothing feeds it */
    DF_DEST_BOUND,          /* a live connection feeds it */
    DF_DEST_WAITING,        /* its last source just went: a short grace */
    DF_DEST_GROUNDING       /* returning to its init (its ground) */
} df_dest_state;
typedef enum {
    DF_END_NONE,
    DF_END_SOURCE,          /* the source finished */
    DF_END_CONNECTION,      /* the connection undid itself */
    DF_END_DESTINATION,     /* this node's host undid it */
    DF_END_OUTSIDE,         /* a remote request, a scene */
    DF_END_LOST             /* the source's node went away */
} df_end_origin;
typedef struct {
    uint32_t      size;           /* sizeof(df_destination) */
    df_dest_state state;
    df_end_origin origin;         /* where its last end came from */
    int           connections;    /* sources it listens to */
    int           live;           /* of them, sources whose node is online */
} df_destination;
/* One param of this node, or a population as a whole: its connections,
 * bound while a source of them is there (set out->size first). */
bool df_destination_get(const df_node* node, const char* path, df_destination* out);
/* fn(path, destination) inside df_node_poll() when a param's state, origin
 * or counts change (the counts are looked at ten times a second). A param
 * never connected and free is not reported. size: sizeof(df_destination). */
typedef void (*df_destination_fn)(const char* path, const df_destination* destination, void* context);
void df_node_on_destination(df_node* node, uint32_t size, df_destination_fn fn, void* context);

/* Populations of this node fed by others' (core 9.1, feature "populations").
 * The core keeps which instance holds each slot: an instance opens when its
 * gate rises (its values already there), in its own slot number if free,
 * else the first free, else one in release gives way, then the oldest (or
 * it is refused, see df_group_settings). Its life has four edges, each
 * reported: OPEN (tentative while a param of role COMMIT is down), COMMIT,
 * RELEASE (its gate fell; a population declared "release": "held" keeps
 * the slot for the resonance until the host calls df_close() or its hold
 * runs out), CLOSE (origin: who; reason: why). Hosts take these from here
 * rather than watching the gate themselves. docs/couches.md, « Vies
 * d'instances ». Both enums are open sets, like df_dest_state. */
typedef enum { DF_EDGE_OPEN, DF_EDGE_COMMIT, DF_EDGE_RELEASE, DF_EDGE_CLOSE,
               DF_EDGE_RELATE   /* its parent param changed, or its parent closed */
} df_edge;
typedef enum {
    DF_REASON_NONE,
    DF_REASON_DONE,         /* it ended as it should (the gate fell, a resonance over) */
    DF_REASON_CANCEL,       /* cut off: its connection undone, closed here while open */
    DF_REASON_LOST,         /* its source's node went away */
    DF_REASON_STEAL,        /* it gave way to a newer one, every slot taken */
    DF_REASON_FAILED,       /* its gate fell before it was committed */
    DF_REASON_MERGE,        /* (kept for later) */
    DF_REASON_SPLIT
} df_end_reason;
typedef struct {
    uint32_t      size;           /* sizeof(df_instance) */
    const char*   population;     /* its path */
    int           slot;
    df_edge       edge;           /* what happened (in df_instance_get: where it stands) */
    bool          open;           /* the slot is taken (open, or released and held) */
    bool          tentative;      /* not committed yet */
    bool          released;
    df_end_origin origin;         /* a close: who */
    df_end_reason reason;         /* a release or a close: why */
    const char*   source_sku;     /* "" for this host's own (df_claim) */
    int           source_slot;
    bool          has_id;         /* its id param said who it is */
    double        id;
    bool          has_key;        /* its key param (re-identification) */
    double        key;
    bool          has_value;      /* the edge's attribute: its attack param at OPEN, */
    double        value;          /* its release param at RELEASE and CLOSE */
    double        age_ms;         /* since it opened (at RELEASE and CLOSE: its duration) */
    bool          has_parent;     /* the id of the instance it belongs to */
    double        parent;
    bool          has_confidence; /* its confidence param, 0..1 */
    double        confidence;
} df_instance;
/* fn(instance) inside df_node_poll(), at each edge (the host's own, from
 * df_claim, df_release, df_close, too): after the poll's values and before
 * its gates, so an edge says why (origin, reason) before its gate says it
 * ended. The strings hold until the next edges. size: sizeof(df_instance). */
typedef void (*df_instance_fn)(const df_instance* instance, void* context);
void df_node_on_instance(df_node* node, uint32_t size, df_instance_fn fn, void* context);
/* What holds a slot now (set out->size first). */
bool df_instance_get(const df_node* node, const char* population, int slot, df_instance* out);
/* This host's own instance (a mouse): a slot taken like any other (0: none
 * free), its params written by the host; released when done. */
int  df_claim(df_node* node, const char* population);
bool df_release(df_node* node, const char* population, int slot);
/* This host ends an instance from the mesh: one in release (its resonance
 * over: DONE), or one still open (CANCEL; kept out until its gate falls).
 * Its source is told (df_node_on_ended there). */
bool df_close(df_node* node, const char* population, int slot);
/* This node's instances, as a source (core 9.1, feature "ids"): a free slot
 * of one of its populations, its id written (has_id; required when the
 * population's ids are DF_IDS_SOURCE, and an instance open with that id is
 * the same one, its slot returned; else the population's next), then its
 * gate. Write its values before the next df_node_poll(): they go ahead of
 * the gate. 0: no such population, no free slot, or no id where one is
 * required. Stopping says its reason (if its slots have a reason param),
 * then lowers its gate. */
int  df_start_instance(df_node* node, const char* population, bool has_id, double id);
bool df_stop_instance(df_node* node, const char* population, int slot, df_end_reason reason);
/* Since API 0.3: a slot's id (its param of role ID, or named "id"), and the
 * open slot (gate up) whose id is that one (0: none), for this node's own
 * instances as a source. */
bool df_instance_id(const df_node* node, const char* population, int slot, double* id);
int  df_instance_slot(const df_node* node, const char* population, double id);

/* One instance of a source population to a plain group or param (feature
 * "pick"): source_path names the instance by a "*" level, the population's
 * path then "/" and "*" (to the instance, a group), and maybe a param in
 * it; the instance is the live one with that id, or by rank among the live
 * ones (1 the oldest, 2 the next, -1 the newest). Asked of dest_sku (this
 * node's sku: made here). Made again with another pick, it picks anew;
 * undone with df_disconnect_remote (the same path). */
typedef enum { DF_PICK_NONE = 0, DF_PICK_ID, DF_PICK_RANK } df_pick;   /* NONE: API 0.3 */
bool df_connect_instance(df_node* node, const char* dest_sku, const char* dest_path,
                         const char* source_sku, const char* source_path, df_pick by, double value);

/* --- this node's destinations, connected by the source's name (API 0.3,
 * feature "listen") --- */

/* A node of the world by its name (its label) or its sku: its sku in out,
 * online ones first. False if none is there (yet). */
bool df_find(const df_node* node, const char* name_or_sku, char out[37]);
/* One of this node's destinations listens to source_path on the node named
 * source (its name or its sku); with DF_PICK_ID / DF_PICK_RANK and value, to
 * one instance of a source population (DF_PICK_NONE: the path itself). The
 * source need not be on the mesh yet: the connection is made at the first
 * df_node_poll() after a node of that name appears, then kept like any
 * other. Asked again for the same ends: nothing more. */
bool df_listen(df_node* node, const char* path, const char* source, const char* source_path,
               df_pick by, double value);
/* What df_listen() made, undone, or no longer waited for. */
bool df_stop_listening(df_node* node, const char* path, const char* source, const char* source_path);

/* Source side: a destination ended an instance of one of this node's
 * populations (closed it, its hold ran out, it gave way): fn(population,
 * slot, the destination's sku, reason) inside df_node_poll(). */
typedef void (*df_ended_fn)(const char* population, int slot, const char* by_sku,
                            df_end_reason reason, void* context);
void df_node_on_ended(df_node* node, df_ended_fn fn, void* context);

/* The whole world as the visualizer sees it (JSON): free with df_free(). */
char* df_world_json(const df_node* node);
void  df_free(char* s);

/* Since API 0.3 (feature "state"): this node's state as one JSON document,
 * to move it to another machine or replace one: its identity, declaration,
 * connections, scenes, phase pin and readable values (never a write-only
 * one, nor what it knows of others). Free with df_free(). Elsewhere: create
 * the node under the state's sku (df_state_sku), df_import_state() before
 * df_node_start(): it is that node again. Its values go to its params as
 * they are declared, as changes from the mesh (on_change hears them). */
char* df_export_state(df_node* node);
bool  df_state_sku(const char* state, char sku[37]);
bool  df_import_state(df_node* node, const char* state);

/* The other nodes' values in the world, asked for at 10 Hz. */
void df_monitor(df_node* node, bool on);

bool df_scene_recall(df_node* node, int slot);
bool df_scene_store(df_node* node, int slot);
bool df_presentation(const df_node* node);              /* the mesh's phase */
void df_set_presentation(df_node* node, bool presentation);

/* Locate (core 9.1): ask a node to show where one of its params is (a light
 * at full, a nudge) for ms; repeat it to hold it, ms 0 stops it. Its host is
 * told: fn(path, on) inside df_node_poll(). false: that node isn't reached. */
bool df_locate(df_node* node, const char* sku, const char* path, uint32_t ms);
typedef void (*df_locate_fn)(const char* path, bool on, void* context);
void df_node_on_locate(df_node* node, df_locate_fn fn, void* context);
bool df_locating(const df_node* node, const char* path);

/* Halt (core 9.1): the mesh-wide stop. While on, every node takes no value,
 * its fed destinations return to their init and its instances close
 * (cancel); off, values flow again. Any node may set or lift it. */
void df_halt(df_node* node, bool on);
bool df_halted(const df_node* node);
typedef void (*df_halt_fn)(bool on, void* context);
void df_node_on_halt(df_node* node, df_halt_fn fn, void* context);

void   df_add_seed(df_node* node, const char* host, uint16_t port);   /* before df_node_start */
bool   df_forget(df_node* node, const char* sku);        /* out of the mesh's memory */
size_t df_forget_offline(df_node* node, bool mesh);

typedef struct {
    uint32_t received, lost, late;
    double   latency_ms;         /* <0: not measured (clocks not synced) */
} df_link;
bool df_link_stats(const df_node* node, const char* sku, df_link* out);

/* The mesh's clock (ms) and whether it is synced. */
double df_mesh_time(const df_node* node, bool* synced);

/* --- since API 0.3 (feature "patching"): what a patching host needs (Max's [data.node]) --- */

/* Its universe; changing it while running leaves the old one's peers and
 * world behind, and moves its storage to storage_dir (NULL: stays). */
const char* df_node_universe(const df_node* node);
bool df_set_universe(df_node* node, const char* universe, const char* storage_dir);
/* The other universes nodes on this network were seen in (mDNS), this one
 * aside: what a scanner lists. */
size_t df_universe_count(const df_node* node);
bool df_universe_at(const df_node* node, size_t index, char out[33]);

/* A full config ({"params": [...]}, as df_node_load_json takes) applied to
 * a running node: what it lacks is removed, the rest declared again, values
 * kept. Its identity and universe can't change this way. False with why in
 * error (capacity bytes, NUL-terminated). */
bool df_node_apply_json(df_node* node, const char* json, char* error, size_t capacity);

/* Something changed in the world (a node came, went, declared again, a
 * connection anywhere): fn() inside df_node_poll(). */
typedef void (*df_topology_fn)(void* context);
void df_node_on_topology(df_node* node, df_topology_fn fn, void* context);

/* Where this node reaches a peer (its address and port), if it does. */
bool df_peer_endpoint(const df_node* node, const char* sku, char address[64], uint16_t* port);

/* This node shows itself (a flash, a sound): asked of it, as of any node. */
void df_identify(df_node* node);

/* Its phase pinned (it keeps it whatever the mesh's), or not. */
void df_pin_phase(df_node* node, bool pinned, bool presentation);

/* Scenes: the mesh's cue and this node's state in it (the applied slot, or
 * a modified or missing one; connections of the last recall it couldn't
 * make), its changes inside df_node_poll(), and a slot's connections. */
typedef enum { DF_SCENE_RECALL, DF_SCENE_STORE, DF_SCENE_STATUS } df_scene_op;
typedef enum { DF_SCENE_NONE, DF_SCENE_APPLIED, DF_SCENE_MODIFIED, DF_SCENE_MISSING } df_scene_state;
typedef struct {
    int            cue;            /* the current cue's slot, 0 none */
    int            current;        /* this node's slot for it, 0 none */
    df_scene_state state;
    int            skipped;
    uint32_t       slots;          /* bit n-1: this node keeps slot n */
} df_scene;
bool df_scene_get(const df_node* node, df_scene* out);
typedef void (*df_scene_fn)(df_scene_op op, int slot, const df_scene* scene, void* context);
void df_node_on_scene(df_node* node, df_scene_fn fn, void* context);
typedef void (*df_scene_link_fn)(const char* local_path, const char* source_sku, const char* source_path,
                                 void* context);
bool df_scene_links(df_node* node, int slot, df_scene_link_fn fn, void* context);

/* --- since API 0.5: what one param shows of its connections, without the
 * visualizer (a menu on a Max box): the sources a destination could listen
 * to, who listens to a source, and how a connection shapes its values --- */

/* A source this node's destination (or bidir) `path` could listen to
 * (feature "sources"): a param of the same type, a source or a bidir,
 * readable, not in a population (a population connects as a whole); this
 * node's own too, `path` aside. By node: this node first, then the others
 * online, then offline, each by its name; a node's params depth first.
 * connected: it feeds `path` now. Writes up to `capacity` entries and
 * returns how many there are (0 for a param that takes no values). */
typedef struct {
    char    sku[37];
    char    node[33];        /* the node's name */
    bool    online;
    char    path[129];
    char    label[33];       /* the param's */
    bool    connected;
} df_source_choice;
size_t df_sources_for(const df_node* node, const char* path, df_source_choice* out, size_t capacity);

/* Who listens to this node's param `path` (feature "listeners"): the
 * destinations it streams to, as the source knows them, each once (a param
 * of this node too; the visualizers' monitors aside). Writes up to
 * `capacity`, returns how many there are. */
typedef struct {
    char sku[37];
    char node[33];           /* its name; "" if the world doesn't know it */
    char path[129];
} df_listener;
size_t df_listeners(const df_node* node, const char* path, df_listener* out, size_t capacity);

/* What a connection does to the values that reach this node's `path` from
 * source_sku's source_path (feature "shaping"; the core's link transform,
 * dataflou/connection.h): per component, the value from `in` (unset: the
 * source's range) to 0..1, through the curve, then to `out` (unset: the
 * destination's range). A curve's points are in 0..1, x increasing;
 * fewer than two: straight. Monotone unless free (a waveshaper). Booleans,
 * numbers, vectors and colours; not text. False if no such connection
 * (or not linked yet: its source's tree not known). */
#define DF_CURVE_POINTS 16
typedef struct {
    bool   in_set, out_set;
    double in_min, in_max;
    double out_min, out_max;
    int    points;
    float  x[DF_CURVE_POINTS], y[DF_CURVE_POINTS];
    bool   free;
} df_axis;
typedef struct {
    uint32_t size;           /* sizeof(df_transform) */
    int      axes;           /* 0: plain; else one per component, up to 4 */
    df_axis  axis[4];
} df_transform;
bool df_transform_get(const df_node* node, const char* path, const char* source_sku,
                      const char* source_path, df_transform* out);
/* Set the transform (axes 0: plain). The connection is said again to the
 * mesh, as a visualizer's edit. */
bool df_transform_set(df_node* node, const char* path, const char* source_sku,
                      const char* source_path, const df_transform* transform);

/* The same by name, as a menu offers it: a curve, the same on every
 * component (linear, ease in, ease out, an S, inverted), and what spans the
 * destination's range: the source's range (the plain mapping), the
 * destination's own (values pass as they are), or 0..1. CUSTOM: none of
 * these (in df_shape_set: that part left as it is). out is left as it is. */
typedef enum { DF_CURVE_CUSTOM = -1, DF_CURVE_LINEAR, DF_CURVE_EASE_IN, DF_CURVE_EASE_OUT,
               DF_CURVE_S, DF_CURVE_INVERTED } df_curve;
typedef enum { DF_RANGE_CUSTOM = -1, DF_RANGE_SOURCE, DF_RANGE_DESTINATION, DF_RANGE_UNIT } df_range;
typedef struct {
    uint32_t size;           /* sizeof(df_shape) */
    df_curve curve;
    df_range range;
} df_shape;
bool df_shape_get(const df_node* node, const char* path, const char* source_sku,
                  const char* source_path, df_shape* out);
bool df_shape_set(df_node* node, const char* path, const char* source_sku,
                  const char* source_path, const df_shape* shape);

/* --- since API 0.6 (feature "arrays", core 9.3): arrays, a param of N values
 * of one type (df_param_settings: type DF_ARRAY, of, count). Their
 * elements are laid out as df_elem says. One element is also a path:
 * "lights/3" is element 3 of "lights", counted from 1 as a population's
 * slots are; df_set(), df_get() and df_set_remote() take it, and a
 * connection may take one element alone into an ordinary param --- */

/* The whole array from `count` values of type `of`, each cast to the
 * param's element type (the first ones if there are fewer, the others
 * kept). A df_set() of one value (a number, a bool, a colour) sets every
 * element. */
bool df_set_array(df_node* node, const char* path, df_elem of, const void* values, size_t count);
bool df_set_remote_array(df_node* node, const char* sku, const char* path, df_elem of,
                         const void* values, size_t count);
/* Its elements as values of type `of` (cast): up to `capacity` written to
 * out; returns how many it has, -1 if `path` is no array of this node. */
long df_get_array(const df_node* node, const char* path, df_elem of, void* out, size_t capacity);
/* Its element type and how many elements it has. */
bool df_array_info(const df_node* node, const char* path, df_elem* of, size_t* count);
/* One element (index from 0), as a value of its own type (number, bool,
 * colour); df_set_element casts the value to it. */
bool df_set_element(df_node* node, const char* path, size_t index, const df_value* value);
bool df_get_element(const df_node* node, const char* path, size_t index, df_value* out);
/* A watched array that changed (as df_node_on_change says, which gives it
 * as DF_ARRAY with its count): fn(path, of, values, count) inside
 * df_node_poll(), its elements laid out as `of` says, valid during the call. */
typedef void (*df_array_fn)(const char* path, df_elem of, const void* values, size_t count, void* context);
void df_node_on_array(df_node* node, df_array_fn fn, void* context);

/* --- since API 0.6 (feature "timed", core 9.3): a value that carries its
 * time, the mesh time (df_mesh_time, ms) it is true at: past (a sensor read
 * earlier) or ahead (a cue). A destination applies a value stamped ahead at
 * its time, holding it until then; one stamped past, at once. Either way
 * the stamp stays readable. An unstamped value is true when it arrives, as
 * before. A peer older than core 9.3 gets the value alone. --- */

/* Any value, cast to the param's type (as df_set), true at `mesh_time`
 * (>= 1; take it from df_mesh_time). */
bool df_set_timed(df_node* node, const char* path, const df_value* value, double mesh_time);
/* The mesh time this node's param's value is true at, as its source stamped
 * it (in a df_node_on_change callback: the value just given; for a param
 * whose every sample counts, the last one's); 0: not stamped, or no such
 * param. */
double df_value_time(const df_node* node, const char* path);
/* How far ahead (ms, default 10000) a stamped value is held; one stamped
 * further ahead is applied at once, and logged. */
void df_set_hold_horizon(df_node* node, double ms);

#ifdef __cplusplus
}
#endif
