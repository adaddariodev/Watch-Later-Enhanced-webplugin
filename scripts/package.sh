#!/bin/sh
# Builds the Chrome Web Store upload: dist/watch-later-enhanced-<version>.zip
#
# From an allow-list, not by zipping the folder: the repo also holds the README,
# the store listing copy and ~650KB of logos and promo banners that the
# extension never loads, and none of that belongs in what users install.
#
# From HEAD, not the working tree: an uncommitted edit or a stray local file
# can never ship, and the zip always matches a commit you can tag.
set -eu
cd "$(dirname "$0")/.."

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
[ -n "$version" ] || { echo "No version in manifest.json" >&2; exit 1; }

files="manifest.json LICENSE
  background.js content.js content.css detach.js detach.css url-utils.js
  popup.html popup.css popup.js wiki.html wiki.css wiki.js
  icons sounds fonts"

# shellcheck disable=SC2086
if ! git diff --quiet HEAD -- $files; then
  echo "warning: uncommitted changes in shipped files are NOT in the zip" >&2
fi

mkdir -p dist
out="dist/watch-later-enhanced-$version.zip"
rm -f "$out"
# shellcheck disable=SC2086
git archive --format=zip -o "$out" HEAD -- $files
echo "$out"
