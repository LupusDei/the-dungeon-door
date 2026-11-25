#!/bin/zsh
# Ship the last commit to TestFlight from this Mac.
#
#   ./ship.sh "What's new in this build"
#
# Builds from a clean copy of HEAD in a temporary git worktree, so work in progress never ends up
# in a build and fastlane's signing/build-number edits never land here. Needs the gitignored
# credentials: Config/Secrets.xcconfig (the server app key) and fastlane/{.env,AuthKey.p8,api_key.json}.
set -e
cd "$(dirname "$0")"
CHANGELOG=${1:-"New build"}
ROOT=$(git rev-parse --show-toplevel)
TREE=$(mktemp -d -t dungeon-door-ship)
git -C "$ROOT" worktree add --quiet --detach "$TREE" HEAD
trap 'git -C "$ROOT" worktree remove --force "$TREE"' EXIT
for file in Config/Secrets.xcconfig fastlane/.env fastlane/AuthKey.p8 fastlane/api_key.json; do
  [[ -f "$file" ]] || { echo "Missing $PWD/$file"; exit 1; }
  /bin/cp -f "$file" "$TREE/ios/$file"
done
cd "$TREE/ios"
echo "Shipping $(git log -1 --format='%h %s')"
xcodegen generate --quiet
bundle install --quiet
CHANGELOG="$CHANGELOG" bundle exec fastlane beta
