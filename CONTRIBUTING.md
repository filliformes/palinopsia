# Sharing your work, and contributing to Palinopsia

## Your shader, generator, mapper or effect is yours

Whoever makes a shader, a Sonify generator, a visual mapper or an effect for Palinopsia
is its **author**. You choose its license, and you keep your name on it. See
[LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md): using what Palinopsia supplies when it
runs your work does not put your work under Palinopsia's GPL.

## Sharing it : the community catalog

[`catalog/catalog.json`](catalog/catalog.json) lists community works. Like Schwung's
module catalog, your work stays in **your own public GitHub repository**; the catalog
only points to it, so it remains yours to update.

- **Today** it lists shaders: ISF files that anyone can drop into their
  `Documents/Palinopsia/Shaders` folder (or open in the Source Editor, `Alt+E`).
- **Sonify generators, visual mappers and effects** join it with the plugin SDK, which
  will be MIT licensed.

### 1. Put your work in a public GitHub repository

- **A license file.** Include one, choosing from the accepted licenses below.
- **For a shader: say who made it.** Name yourself in the ISF header's `CREDIT` field
  (`"CREDIT": "Your Name"`), and describe what it does in `DESCRIPTION`.
- **Credit what isn't yours.** If your work contains anything by someone else (a noise
  function, a technique ported line by line, a texture), name it in a comment where it
  is used, with its author and license. That other work's license must allow sharing
  it, too.

### 2. Open a pull request that adds your entry

Add one object to `entries` in `catalog/catalog.json`:

```json
{
  "id": "tide-lines",
  "name": "Tide Lines",
  "kind": "shader",
  "author": "Your Name",
  "repo": "your-github-name/your-repo",
  "path": "shaders/TideLines.fs",
  "commit": "the full 40-character commit hash of the version to list",
  "license": "MIT",
  "description": "One or two sentences : what it draws or does, and its controls.",
  "added": "2026-11-20",
  "credits": ["Hash without Sine, David Hoskins, MIT (the noise)"]
}
```

| field | |
|---|---|
| `id` | lowercase-with-dashes, unique in the catalog |
| `kind` | `shader` (today); `sonify-generator`, `visual-mapper`, `effect` (with the SDK) |
| `repo`, `path` | where the file is, in your repository |
| `commit` | a full commit hash, never a branch or tag: what is reviewed is exactly what people get. Open a new PR with a new hash to list an update |
| `license` | its SPDX id, from the list below |
| `credits` | optional: one line for each thing inside it that is someone else's |
| `homepage`, `preview`, `min_palinopsia` | optional: a page about it, an image URL, the oldest version it runs on |

`npm run check:catalog` checks your entry; CI runs it on every pull request build.

### Accepted licenses

- **Permissive or public domain:** MIT, MIT-0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib,
  Apache-2.0, 0BSD, Unlicense, CC0-1.0.
- **Copyleft:** GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, LGPL-2.1-or-later,
  LGPL-3.0-or-later, MPL-2.0.
- **Creative Commons:** CC-BY-4.0, CC-BY-SA-4.0.

**Not accepted:**
- **non-commercial or no-derivatives** licenses (CC BY-NC, CC BY-ND), because people
  must be free to perform with your work and build on it;
- **CC BY 3.0 and older**;
- **work with no license.** Shadertoy code without an explicit license is CC BY-NC-SA
  3.0 by default, so it is out too.

### How entries are chosen

Vincent reviews each pull request:
- **it runs:** it compiles, and it holds up over a long show;
- **it is credited:** everything borrowed is named, under an accepted license;
- **it fits:** it sits well beside the instrument's voice, which is matte and glitchy,
  never cheap psychedelia.

The catalog is curated, and a work can be declined or asked for changes. Accepted works
are listed under their authors' names.

## Contributing to Palinopsia itself

Code, fixes and documentation for the app are welcome as pull requests. They are under
Palinopsia's license, **GPL-3.0-or-later** (and MIT for the plugin SDK, once it
exists). Whatever you bring in from someone else gets its entry in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same pull request, and
`npm run check:notices` must pass. The rules are in [CLAUDE.md](CLAUDE.md), under
"Credits and licensing".
