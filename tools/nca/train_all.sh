#!/usr/bin/env bash
# Train the Grown generator's textures from the shipped CC0 scans (ambientCG).
# Needs a Python venv with torch + torchvision (CUDA) : set PY to its python.
# Writes src/renderer/public/nca/<id>.bin (+ a _preview.png next to it : delete
# before committing, or keep out of the build).
set -e
PY="${PY:-python}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
PBR="$ROOT/src/renderer/public/pbr"
OUT="$ROOT/src/renderer/public/nca"
ITERS="${ITERS:-3000}"
mkdir -p "$OUT"
train() { "$PY" "$HERE/train_texture_nca.py" "$PBR/$2/color.jpg" "$OUT/$1.bin" --iters "$ITERS"; }
train lava Lava004
train moss-rock Rock063
train bark Bark014
