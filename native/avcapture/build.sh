#!/bin/sh
# Build the AVFoundation input addon (macOS; the command line tools are enough,
# no framework to build) for the app's Electron version, then load it once in
# Node and list the devices, so a broken build fails here rather than in the app.
# Run from anywhere : sh native/avcapture/build.sh
set -e
cd "$(dirname "$0")"

ARCH="${ARCH:-$(uname -m)}" # arm64 on Apple Silicon

rm -rf build
npm install --ignore-scripts --no-audit --no-fund
ELECTRON=$(node -p "require('../../node_modules/electron/package.json').version")
npx --yes node-gyp@11 rebuild --target="$ELECTRON" --dist-url=https://electronjs.org/headers --arch="$ARCH"
# arm64 code must carry a signature to load at all : an ad-hoc one is enough.
codesign --force --sign - build/Release/avcapture.node
# N-API is ABI-stable : the Electron build loads in plain Node too.
node -e "const a = require('./build/Release/avcapture.node'); a.enable(); console.log('devices :', JSON.stringify(a.list()))"
echo "built native/avcapture/build/Release/avcapture.node (Electron $ELECTRON, $ARCH)"
