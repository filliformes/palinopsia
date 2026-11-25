// version.h — dataflou core version: the library and its protocol.
//
// MAJOR.MINOR, a loose semver. Nodes of the same major work together:
//   - minor: something added (a message, a param type, a feature) that an
//     older peer of the same major ignores or lacks; nothing breaks;
//   - major: a change that breaks an older peer (wire format, the meaning of
//     a message). PROTO_VERSION (protocol.h) only changes with a major.
// One exception: 9.1 breaks with 9.0 (PROTO_VERSION 4). 9.0 was published
// too early and nobody runs it; a 10 would have made 8.x users read two
// breaks. Peers compare the wire format (same_wire_format, pal.h), so a 9.0
// and a 9.1 don't call each other, and refuse each other at HELLO.
// (docs/couches.md, "La connexion poly".)
//
// Peers see it in mDNS (core_ver) and the visualizer in snapshots
// (core_version). Bump it when src/core, include/dataflou or the protocol
// change, not for a host's own changes: the Max package (max/package-info.json)
// and the other front ends carry their own versions.
//
// 8.0: the core as the TypeScript port tracks it (ead3801)
// 8.1: scenes
// 8.2: oversized frames skipped, not fatal; HELLO says max_frame and role;
//      the source role (publishes only, no world view)
// 8.3: connections known mesh-wide: a node follows its DECLARE with a clear
//      and its connections (SUBANNOUNCE), a DECLARE no longer wipes the ones
//      known; mDNS takes only _dataflou._tcp instances for peers; a
//      connection sends by its source's mode (discrete on change, capped by
//      rate; streaming at rate) instead of on every poll, unchanged values as
//      refreshes (stream magic 0xDF 0x02) that receivers apply only if they
//      differ
// 8.4: smooth and ground act on destinations: smooth [up, down] is the ms
//      to reach a value from a connection (was unused coefficients), ground
//      brings a destination back to its init when its last source goes
//      (connection removed, source offline) instead of resetting the
//      departed node's own params in the world view
// 8.5: poly groups: a group can say it is a population of N slots (config
//      kind "poly" declares its children once and gets them N times, as the
//      groups 1 … N; DECLARE key 18, world JSON "slots"). Older peers see an
//      ordinary group. Room in storage for 16 KB of subscriptions (was 2 KB,
//      some 35 of them, the rest silently lost at restart); one that still
//      does not fit is logged. What a node refuses from a peer: any message
//      before its HELLO; a HELLO under our own sku; a FLUSH or a DECLARE of
//      our own entry; a DECLARE whose identity names another node; a blob key
//      that leaves the storage folder or names one of the node's own files.
//      A HELLO or DECLARE with no identity is refused, not half read
// 8.6: the satellite role: a node that publishes and
//      receives but keeps of the world who is there (identities, online)
//      and the params only of the nodes it listens to, and relays nothing
//      about others; "role":"satellite" in a config, in HELLO. A node also
//      remembers the other universes it sees on the network (universes_seen).
//      Fixes: an inbound stream looks its source up again when the world
//      view moves (no stale pointer); scene counters compare as serial
//      numbers (a huge counter no longer silences recalls); a remote set or
//      stream value is cast to the destination's type or dropped; the
//      declaration counter survives a restart (storage key "decl"); a node
//      that comes back on a new connection retires the old one, and a node
//      stays online while any connection to it lives; a stream request
//      refused for want of a stream target is logged.
//      No fixed capacity left in the core's model: params, children per
//      group, sources per param, classes, world nodes, peers, connections,
//      glides, monitors, saved subscriptions and scenes grow as needed from
//      one memory account with an optional budget (memory.h), and refuse
//      with a reason when it runs out instead of truncating in silence;
//      subscriptions are written to storage when they change, not every 5 s;
//      a connection that sends no HELLO within 10 s is closed (it used to
//      stay, and block any new dial to that node); a DECLARE's params are
//      decoded straight into the world entry (no scratch copy, nothing shared
//      between nodes of one process), a satellite doesn't decode those of a
//      node it doesn't listen to, and params that don't fit are logged; a
//      frame's receive buffer is allocated at its exact size, and a frame
//      that doesn't fit is skipped, the connection kept. A board sets the
//      core's memory at runtime: a floor (heap kept free, read from the heap
//      at each allocation) and an optional budget, from the config's
//      "memory" entry or from what it finds (memory_config.h); a sketch
//      declares what it allocates later (Device::reserve, "sketch_kb").
//      Forgetting: a satellite drops a node's params when it stops
//      listening, forgets an offline node after a delay (60 s) and takes no
//      stranger from gossip; a full node short of memory forgets the
//      offline node heard from longest ago; forget_offline() forgets them
//      all, here or across the mesh (FLUSH). Text (text.h): values, param
//      metadata, node labels and paths hold 15 characters inline and
//      allocate only beyond (a value 176 -> 40 bytes, a remote param
//      376 -> 200, a local param 768 -> 296, on 32 bits). A board no longer
//      keeps a copy of its own tree in its world entry; a declaration about
//      a node itself is always made from its own tree. The encode buffer
//      starts at 1 KB and grows on demand up to DATAFLOU_MAX_MSG_BUF (16 KB
//      on boards, where it was a fixed 2 KB), back to 1 KB after a big
//      message; lists grow by half on boards. A decoded message's member is
//      destroyed after use (with growable version vectors, every HELLO and
//      DIGEST leaked: 1.3 KB per digest, found by the memory probe). On a
//      transport with few connections (ITcp::connection_limit: 5 on a
//      W5500) a node keeps one spare, closing the least useful peer past a
//      15 s grace and never one values flow through, and doesn't dial a
//      node it has no use for while at the limit; such a close is said first
//      (DETACH) so the peer doesn't take it for the node going offline.
//      Phases (scene.h): préparation / présentation, a cue shared by the
//      mesh like a scene's (HELLO, DIGEST, PHASE; stamped, the latest wins;
//      kept in storage; a node may pin its own). In presentation a satellite
//      keeps one full node and what carries values, full nodes don't call
//      satellites they have no business with, the node that listens calls
//      its source, digests slow down; back in preparation nodes look around
//      again
// 9.0: a clean break (PROTO_VERSION 3): a node checks the protocol in HELLO
//      and doesn't call a node whose mDNS record names another major; it
//      keeps the ones it met as incompatible, for the visualizer. ground is
//      one or two durations in seconds (up, down; absent: the value stays),
//      straight in the param's nature; smooth is gone (values arrive as they
//      are). A destination has a state, bound / waiting (its source gone, a
//      1 s grace) / grounding / free, and the origin of its last end
//      (destination, outside, lost), reported to its host. A connection has
//      an id (Lamport counter + creator), given by the node that makes it,
//      announced, saved (subscription record format 2, older records get
//      ids on load) and kept by scene recall. A source answers a stream
//      request with its type, mode and range (STREAMREPLY). HELLO and DIGEST
//      say the node's memory (used, room); mDNS says the role. A poly group
//      is declared as its template (slot 1), the receiver makes the other
//      slots. Stream packets format 3: stream ids, sequence numbers (loss,
//      late packets dropped), mesh time (latency). A trigger type, sent over
//      TCP (FIRE). A mesh clock (TIME). HELLO lists features by name and
//      says the universe ("auth" reserved). Seeds: nodes dialled by address,
//      and declarations say where a node is reached. (docs/couches.md,
//      "Le saut de protocole"; docs/protocol.md.) After its release:
//      config.h gives the build settings by platform (the Arduino IDE
//      passes no flags); a node on another version is kept with its
//      address, port, full core version and product, for the visualizer.
// 9.1: an exception, incompatible with 9.0 (PROTO_VERSION 4): the poly
//      connection (docs/couches.md, "La connexion poly"). A node doesn't
//      call one whose mDNS record says another wire format (9.0 and 9.1
//      are the same major). The connection registry (group to group, links
//      by name, CONNS with versions in the digests, LINKEDIT, stream ids
//      chosen by the destination); a tick's values for one destination in
//      one packet; populations with an allocation table, nested, and an
//      instance's four edges with reasons, roles and ENDED (docs/couches.md,
//      "Vies d'instances"), run as a transition table (etl::state_chart);
//      transforms on links; ranges travelled in their nature; every-sample
//      params; unknown values; LOCATE and HALT; who gives a population's
//      ids; one instance picked (by id or rank) to a plain group or param;
//      a blob set from another node carries its bytes; "from" in HELLO
//      only, skus as their 16 bytes; every stream into a node numbered by
//      it, the source's hash only a check. Stream format 4.
// 9.2: compatible with 9.1 (the same wire; what is new is said in HELLO or
//      changes nothing a 9.1 peer reads). A computer takes frames up to 4 MB (said in
//      HELLO) and reads up to 64 KB from a peer per poll; a frame goes whole
//      and in order (what the socket doesn't take waits in a per-peer queue;
//      before, the rest was lost and the connection fell out of step); a
//      stream packet's buffers live on the node, 1400 bytes on boards too;
//      a full packet goes before the next value takes a slot. listen: a
//      destination connected by its source's name, made once that node is
//      there. Write-only params (access write) keep their value home: no
//      stream or monitor of them, unknown in every world view, no init in
//      their declaration. A node whose peers hold a later declaration of it
//      than its own count (its storage lost, moved to another machine) goes
//      on from theirs, as it did for its connections. A node's state to
//      move it (save_state, state_key: its storage records; the document is
//      desktop/state_json.h).
//      The universes seen on the network follow their nodes: one leaves the
//      list with its last node (Bonjour's goodbye, or 45 s unheard on a
//      backend that asks again and again; IMdns::reports_lost). A trigger
//      destination is not grounded: it fired once when its source left.
//      A node back at once under its name on another port is called again
//      there: a peer that loses it, or fails to reach it, has mDNS look it
//      up again (IMdns::look_again; Bonjour resolves anew, where it gave
//      the old port forever).
//      Node::listeners: who a source of ours streams to, as it knows it
//      (each destination once, the monitors aside), for a host that shows
//      a param's connections without the visualizer.
//      A path segment has no length limit: it was cut to 32 characters while
//      a path was walked, though declare_group kept it whole (a long group
//      name made two groups). A path is at most 255 bytes (kMaxPathLength:
//      a stream packet names it in a byte-counted string), refused at
//      declaration beyond, never cut; a stream's name was cut at 128, a
//      DECLARE path at 256.
//      access: readwrite is the default, a source's too (it was read, and
//      the C API and Arduino declared their sources read); read exists only
//      when said, and the node then refuses a set from outside: a peer's
//      SETVAL (logged, the wire has no reply) or set_value_remote to itself
//      (Error::ReadOnly). The node's own set_value is unchanged; a
//      connection into a read param is not refused. The wire is the same
//      (key 7 always carried access; it now says readwrite where it said
//      read by default).
// 9.3: compatible with 9.1 and 9.2.
//      Arrays (array.h): a param of N values of one type (float, int,
//      bool, colour, byte), "type": "array", "of", "size"; one range for
//      all, mapped element by element, a link's transform shared; one
//      element is a path ("lights/3", from 1) a link may take alone into an
//      ordinary param, and a set may write. DECLARE keys 25 (of), 26 (size);
//      a stream entry of kind 9 (the element type, then the elements, bools
//      as bits); SETVAL and STREAMREPLY carry them. A 9.1 or 9.2 node skips
//      the entries and keeps an array as a param of a type it doesn't know
//      (tests/array_compat92_test.cpp); a node now leaves out a param of a
//      type it doesn't know. (docs/couches.md, "Les tableaux (9.3)".)
//      Merging at the destination (docs/couches.md, "La fusion à la
//      destination"): a destination fed by several links combines them by
//      its "merge" (config, DECLARE key 27, absent for ltp; an older peer
//      ignores it): ltp, the default (the last value wins, as before), htp
//      (the highest; per channel for a colour, OR for a bool) or avg (the
//      mean; per component for a vector; a bool on when any is); vectors
//      declared htp, text, blobs and triggers stay ltp. Each link keeps its
//      last value in its inbound entry (mapped to the destination first),
//      across relinks; a link gone leaves the merge at once, a source lost
//      after the destination's grace (1 s: a brief cut doesn't lower an
//      htp; back with a value before, it stays); ground when none is left.
//      C API 0.6: df_param_settings.merge.
//      An array merges element by element, by its element type's rule (a
//      number's highest or mean, rounded into an int or a byte; a colour's
//      per channel; a bool's OR, in both modes); LTP takes the whole array.
//      The visualizer's monitors of a peer are asked again at its HELLO,
//      as its connections are (resend_stream_requests_for_peer): a node
//      back on a new connection before the old one was found dead stayed
//      online, and its monitored values froze until the 15 s keepalive.
//      Asked again too at each of its DECLAREs while no value has come
//      (a relaunched host declaring its params after its HELLO).
//      Values that carry their time (docs/couches.md, "Les valeurs datées"):
//      set_value_at stamps a value with the mesh time it is true at; a
//      stream entry of kind 10 carries it (a 4-byte offset from the
//      header's time, the value's type, the value: arrays compose), sent
//      only to a peer whose HELLO says "timed" (an older one gets the value
//      alone); FIRE takes "at". A destination applies a stamped value at
//      once if past, holds it until its time if ahead (no part in a merge
//      until then), at once and logged past the hold horizon (10 s,
//      set_hold_horizon); value_time reads it (0: unstamped, as before).
//      C API 0.6: df_set_timed, df_value_time, df_set_hold_horizon.
//      A host's feature in HELLO: "editable", its host applies a page's
//      edit of a param's settings (PADMIN update_fields; dataflou-node with
//      its page, the Mac app), set with Node::set_host_features before
//      start(); peer_features reads a direct peer's. The visualizer offers
//      those edits (a destination's merge) only where it is said.
//      Node::hold_declarations / release_declarations: declarations made
//      in between are said in one DECLARE at the last release (an
//      adapter's thousands of params, otherwise one DECLARE to every peer
//      each); Node::streamed: every stream a node sends, its param and
//      whether a visualizer's monitor asked it, in one pass. The wire is
//      the same.
//      A param's stamp takes the place of timestamp_ms (written at each
//      received value, never read: gone); the world snapshot says "stamp"
//      per param and "mesh_ms" at its root.
//      The config's "value" gives any param its starting value (an array's
//      already did), when the load declares it.
#pragma once

#define DATAFLOU_VERSION_MAJOR 9
#define DATAFLOU_VERSION_MINOR 3

#define DATAFLOU_STR_(x) #x
#define DATAFLOU_STR(x) DATAFLOU_STR_(x)
#define DATAFLOU_VERSION DATAFLOU_STR(DATAFLOU_VERSION_MAJOR) "." DATAFLOU_STR(DATAFLOU_VERSION_MINOR)
