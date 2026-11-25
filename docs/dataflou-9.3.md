# Palinopsia on dataflou 9.3

Palinopsia's dataflou node was a TypeScript port of the core at protocol 2 (core 8). A 9.x
mesh refuses it. Since v1.3.6 the node is dataflou's own core 9.3 (protocol 4), behind its C
interface (API 0.6), in a native module : `native/dataflou`. This page holds what was
decided (2026-11-25) and why. The whitepaper's r13 (24 November 2026) and
`dataflou_c.h` are the reference.

## Decisions

1. **9.3 only.** No protocol 2 option : every instrument of the mesh moves to 9.x together.
   The protocol 2 code is gone. A node of core 8 or 9.0 is seen, named and refused.
2. **The same tree** : same names and paths, ranges, labels, units and natures. Every parameter
   is readable : a destination's value is where the control stands in Palinopsia, whoever
   moved it (the hand, OSC, MIDI, a scene). A source is `read` : only Palinopsia sets it.
3. **What fires once is a trigger** : the actions (`act/...`, scenes, favorites), and `vary`,
   `next`, every `randomize`, `output/reset`. Never lost nor doubled, over TCP. The six audio
   bands are one float array, `audio/bands` (one band is also a path : `audio/bands/3`),
   beside the separate audio values, which stay. **Second step, not done : the bodies and the
   hands as populations** (people in front of the camera come and go : instances with an id,
   a gate, a confidence). Until then the `body/*` values stay as they are, and another node's
   population is shown as one line, wired one instance at a time from the visualizer.
4. **A scene of the mesh recalls connections**, as in the core. An option (off by default, in
   the dataflou section) also recalls Palinopsia's scene of that number. A node that joins
   late catches up with the current cue : with the option on, so does Palinopsia.
5. **A lost source** : the value is held (no `ground` is declared). The per-wire **glide back**
   stays. It now starts when the mesh says the destination is free, not after two quiet
   seconds : in 9.x a fader at rest sends nothing, and is not lost.
6. **Identity kept** : the sku in `userData/dataflou/identity.json`, the universe, on or off. The
   `<name>-session` node of v1.3.3 (its sku is made from ours) is still forgotten when the mesh
   remembers it.
7. **What the section shows** : for each wire, bound / waiting / grounding / free and where the
   last end came from; the refused nodes by name and core; the discovery status when it is
   not well (the core knows it on macOS only); a HALT light; the mesh's presentation phase.
8. **The session's wires** : a session publishes only while it is open, never the Session
   heading's actions, and is never written to this computer's list. See below.

## A parameter that leaves

In 9.3 a parameter is declared for the life of its node, and nothing removes one on shutdown.
Two things of Palinopsia's are not the node's for life : what the open session's wires need
published, and a modulator's mesh input (`input/<n>`). Choice : **they are removed, deliberately,
when the session closes or the modulator lets go** (the tree is given again with
`df_node_apply_json`, which removes what it lacks and says the node again to every peer at once).
The alternative, declared but inert, would leave other nodes with parameters that answer to
nothing, which is the ghost we do not want. A wire another node had on one of them stays
dormant there, and plays again when it is published again. Quitting removes nothing : the
node is absent, its parameters and everyone's connections stay.

A removed parameter's few hundred bytes are not given back by the core until the node closes :
sessions opened and closed do not add up to anything that matters (measured below).

## Where a wire lives

The core keeps this node's connections (`userData/dataflou/node-<universe>/`). That is this
computer's list. `wires-<universe>.json` beside it says which of them are NOT the computer's
(the session's, a modulator's), so they are undone when the node starts again without that
session, after a crash too; and keeps what the core does not : the computer's wires set
aside while the session wires their destination or source, each wire's smoothing and on-loss.

A wire's **range and invert are dataflou's own link transform** (`df_transform`) : the
destination's range cut, and the inverted line. They match ours exactly on a linear 0..1
destination, and the visualizer shows them. A curve or a source range set in the visualizer is
kept and shown as "shaped on the mesh". Smoothing and glide back stay Palinopsia's : the core
has none.

**From v1.3.5** : `bindings-<universe>.json` and `scenes-<universe>.json` are given to the core
once, by name and sku as they were, in the record format it still reads from before 9.1
(`node_storage.cpp`); the old files stay beside as `.v135`. A wire's range and invert are given
to the core as soon as its destination is there.

## A trigger fed by something else

In the core anything that arrives fires a trigger : each change of a fader, each refresh, the value
sent as a connection is made. A knob wired to `randomize` would fire sixty times a second, and
once at every reconnection. Palinopsia has always fired on the rising edge, half way up the
source's range : that is kept, in the module (`TriggerGate`). A trigger wired to a trigger is
exact.

## The thread

A `df_node` belongs to one thread. Three ways were weighed, on the development machine
(Windows 11, Electron 44, the node polling every 4 ms) :

| | late p50 | late p95 | late max | while the main process is busy 25 ms in 120 |
|---|---|---|---|---|
| a 4 ms timer in the main process | 0.5 ms | 1.1 ms | 2.5 ms | p95 1.8 ms, max 26 ms |
| a 4 ms timer in a utility process | 11.7 ms | 12.1 ms | 12.7 ms (the 15.6 ms Windows timer) | not affected |
| the module's own thread | mean 1.0 ms | none over 5 ms | 2.6 ms | mean 1.0 ms, max 2.5 ms |

A poll takes 0.04 ms with 500 parameters of which none is connected, 0.05 ms on average under
the test's traffic, 2 ms at most in a minute (a state file written). The core looks at each
**watched** parameter twice a poll (1.3 us) : with all 500 watched a poll took 0.63 ms, 16 % of
a processor. So only what is or was connected is watched; the rest is looked at 25 times a
second (`df_addon.cc`).

Choice : **the module's own thread**, a 4 ms poll, commands queued to it and answered by a promise,
events drained in batches (one wake for everything that waits). The main process does nothing
for the node but pass values to the renderer once a frame. The 1 ms Windows timer is held while
the node is on. A utility process would isolate a crash of the core, for one more process and
one more hop for every value; nothing seen here asked for it.

## Workarounds looked at again

| Then (protocol 2) | Now |
|---|---|
| one DECLARE frame under 32 KB, the last actions left out, the 8 KB warning for boards | gone : computers take 4 MB frames. A small board says how much it takes and is not sent a bigger tree |
| 128 entries, 32 children, 32-character names on C++ nodes (`dfCppHidden`) | gone : no fixed sizes |
| four wires on a destination | gone |
| redial of lost peers, `wake()` | gone : the core dials again. A computer that wakes, or whose address changed, starts its node again (its sockets belonged to the old network) |
| STREAMREQ monitors at 10 and 30 Hz | `df_monitor`, 10 Hz : a watched value (◉) and a learn read it |
| a modulator's mesh input as a hidden stream | a destination of its own, `input/<n>`, declared while in use |
| bools momentarily on for actions | triggers |

## Limits, known

- The visualizer served by Palinopsia shapes Palinopsia's own links; another node's link, and any
  parameter's declaration, are edited from a dataflou-node page (the C interface has no call for
  them).
- The picture values (`vision/*`) are measured only while a wire, a modulator, OSC or Palinopsia's
  own visualizer page wants them : another node's monitor alone does not wake them.
- A session wire's curve set in the visualizer is not saved in the session (its range, invert,
  smoothing and on-loss are).
- The shapes a mesh scene of v1.3.5 had stored are given to the wires when the scene makes them,
  not stored in the scene's record until it is stored again.
