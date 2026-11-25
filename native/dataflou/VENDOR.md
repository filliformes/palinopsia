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

**No file is changed** (line endings aside) : a fix goes to the dataflou repository, then here.

The dataflou repository is on a private gitlab, so CI cannot clone it : that is why a copy
lives here. To refresh it, from a checkout of dataflou and the dependencies a CMake configure
of it fetches (its `_deps` folder) :

```sh
node scripts/vendor-dataflou.mjs <dataflou checkout> <commit> <build folder>/_deps
```

Then : build (README.md), `node tools/dataflou-test/run.mjs`, look at `capi/api.txt` for
what the C interface changed, raise the commit here and in `THIRD_PARTY_NOTICES.md`, and
`npm run check:notices`.
