#!/bin/sh
# Build the Syphon sender addon (macOS, needs Xcode) :
#   1. Syphon.framework from source, at a pinned commit of Syphon/Syphon-Framework
#      (BSD). Its Metal server needs the shader library compiled into the bundle,
#      which is why it's built with xcodebuild rather than compiled into the addon.
#   2. the N-API addon against it, for the app's Electron version,
#   3. the framework copied next to syphon.node (found through @loader_path).
# Run from anywhere : sh native/syphon/build.sh
set -e
cd "$(dirname "$0")"

SYPHON_REPO=https://github.com/Syphon/Syphon-Framework.git
SYPHON_COMMIT=f4761677a45b8034a3c2069ec0f3d2553da81fba
ARCH="${ARCH:-$(uname -m)}" # arm64 on Apple Silicon

rm -rf .syphon-src .syphon-build frameworks build
git init -q .syphon-src
git -C .syphon-src remote add origin "$SYPHON_REPO"
git -C .syphon-src fetch -q --depth 1 origin "$SYPHON_COMMIT"
git -C .syphon-src checkout -q FETCH_HEAD

xcodebuild -quiet -project .syphon-src/Syphon.xcodeproj -target Syphon -configuration Release \
  ARCHS="$ARCH" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO SYMROOT="$PWD/.syphon-build" build
mkdir -p frameworks
cp -R .syphon-build/Release/Syphon.framework frameworks/
# arm64 code must carry a signature to load at all : an ad-hoc one is enough.
codesign --force --sign - frameworks/Syphon.framework

npm install --ignore-scripts --no-audit --no-fund
ELECTRON=$(node -p "require('../../node_modules/electron/package.json').version")
npx --yes node-gyp@11 rebuild --target="$ELECTRON" --dist-url=https://electronjs.org/headers --arch="$ARCH"
cp -R frameworks/Syphon.framework build/Release/
echo "built native/syphon/build/Release/syphon.node + Syphon.framework (Electron $ELECTRON, $ARCH)"
