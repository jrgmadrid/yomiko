#!/usr/bin/env bash
# Builds the macos-vision-ocr Swift sidecar into resources/bin/.
# Invoked by `npm run build:sidecar:mac`.

set -euo pipefail

cd "$(dirname "$0")"
project_root="$(cd ../.. && pwd)"
out_dir="$project_root/resources/bin"
mkdir -p "$out_dir"

# Build for current arch only in Ship 2. Universal binary (arm64+x64) is
# Ship 5 distribution work — we add `lipo` then.
swiftc -O main.swift -o "$out_dir/macos-vision-ocr"

echo "built $out_dir/macos-vision-ocr"
