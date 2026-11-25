#!/bin/zsh
# Build and (re)launch Dungeon Door on a simulator. Extra args go to the app, e.g.
#   ./run.sh -apiBase http://localhost:3000          # use a local dev server
#   ./run.sh -apiBase http://localhost:3000 -openGame ABCDEF
set -e
cd "$(dirname "$0")"
SIM=${SIM:-5B2DFDBB-EAB6-4AD9-9B67-294661A0EE3C}   # iPhone 16 Pro Max
xcodegen generate --quiet
xcodebuild -project DungeonDoor.xcodeproj -scheme DungeonDoor -destination "platform=iOS Simulator,id=$SIM" \
  -derivedDataPath build/DerivedData build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
xcrun simctl boot $SIM 2>/dev/null || true
xcrun simctl terminate $SIM com.jmm.the-dungeon-door 2>/dev/null || true
xcrun simctl install $SIM build/DerivedData/Build/Products/Debug-iphonesimulator/DungeonDoor.app
xcrun simctl launch $SIM com.jmm.the-dungeon-door "$@"
