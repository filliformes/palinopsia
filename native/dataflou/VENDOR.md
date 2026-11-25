# What is vendored, and how to refresh it

`sdk/` holds only what the addon compiles, at pinned versions ([sdk/PINS.md](sdk/PINS.md)),
each folder with its license :

| folder | what | license |
|---|---|---|
| `sdk/dataflou` | dataflou core 9.3, its desktop and Apple platform layers, its C interface (API 0.6), commit `6d5c707` of branch `windows-9.3` (the Windows port) | MIT |
| `sdk/etl` | Embedded Template Library 20.45.0 (headers) | MIT |
| `sdk/qcbor` | QCBOR 1.6 | BSD-3-Clause |
| `sdk/cjson` | cJSON 1.7.19 | MIT |
| `sdk/asio` | asio 1.36.0 (headers, standalone) | BSL-1.0 |
| `sdk/mdns` | mdns 1.4.3 (one header) | public domain (Unlicense) |

**Two lines of the core are added** (`src/core/node_messages.cpp`, marked `PALINOPSIA FIX`,
line endings aside nothing else is changed) : found while testing, to be proposed to the dataflou
repository, put back by the vendoring script until they are in it.

1. When a node says HELLO, its streams' packet counts start over here. Without it a source that
   comes back (a program restarted) has its packets taken for late ones until its count passes
   where it was, if it had sent fewer than 64 : a fader was not heard for up to a minute.
   **The other nodes of the mesh need it too, to hear Palinopsia after it restarts.**
2. A source met for the first time in a run is in the world only after its destinations are
   settled : a connection kept from the last run fed its destination, which still read "free"
   (and never waited when that source left). They are settled again once it is there.

Not changed, known : a trigger source sends one firing a poll (two within a few ms are one).

The dataflou repository is on a private gitlab, so CI cannot clone it : that is why a copy
lives here. To refresh it, from a checkout of dataflou and the dependencies a CMake configure
of it fetches (its `_deps` folder) :

```sh
node scripts/vendor-dataflou.mjs <dataflou checkout> <commit> <build folder>/_deps
```

Then : build (README.md), `node tools/dataflou-test/run.mjs`, look at `capi/api.txt` for
what the C interface changed, raise the commit here and in `THIRD_PARTY_NOTICES.md`, and
`npm run check:notices`.
