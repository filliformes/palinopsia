# Palinopsia : rules for every change

## Credits and licensing (imperative)

Palinopsia must stay a clean product that gives full recognition to other people's
creative work. This comes before any feature.

- **One register.** `THIRD_PARTY_NOTICES.md` lists everything borrowed: code, shaders,
  ported algorithms, binaries, models and their training data, fonts, images, clips,
  sounds, and the ideas and research behind features.
  - Add the entry in the **same commit** that brings the thing in.
  - The entry gives the authors, URL, license and copyright line. Put the license text
    in `licenses/` when the license asks for it.
- **Tag the code.** Write `third-party: <entry name>` at the place of use. The name must
  match the register.
- **Run the check.** `npm run check:notices` must pass before committing; CI runs it
  before every build. After a dependency change, run `npm run notices` and commit
  `licenses/npm-dependencies.txt`. New fonts go in `licenses/fonts.txt`.
- **Read the upstream license yourself before borrowing.**
  - **Never borrow:**
    - code with no license;
    - CC BY-NC / BY-ND, or CC BY 3.0 and older. Shadertoy's default is CC BY-NC-SA 3.0;
    - GPL-2.0-only, proprietary, "all rights reserved" or "educational use only" code;
    - decompiled or reverse-engineered proprietary code;
    - non-commercial models or datasets.
  - **When unsure**, write it independently from the published method, credit the idea
    in the register's Part 6, and ask Vincent.
- **Real, faithful research.** Cite only sources you can name exactly (authors, year,
  title, venue, DOI or URL), and never invent one. Summarise findings as the paper states
  them.
- **No borrowed names.** Never name a preset, mode or feature after a living artist, a
  commercial product or a product's own modes.

## What people build with Palinopsia (decided 2026-11-14)

- **The future plugin SDK will be MIT.** It covers the plugins the picture controls, so
  anyone can build plugins and release them under any license. Like the shaders people
  write in the Source Editor, what they build is theirs.
- **Code in the SDK must be Vincent's own or under a permissive license** (MIT, BSD,
  ISC, Apache-2.0, zlib, CC0).
  - Never move GPL or LGPL code into it: Ableton Link, FFmpeg, datamoshing-GLSL,
    transflow and the rest of the app stay GPL.
  - An SDK file that holds third-party permissive code keeps that code's notice, and
    the SDK gets its own `THIRD_PARTY_NOTICES` section.
- **Palinopsia itself stays GPL-3.0-or-later.**
