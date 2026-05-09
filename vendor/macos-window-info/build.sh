#!/usr/bin/env bash
# Builds the macos-window-info Swift sidecar into resources/bin/.
set -euo pipefail

cd "$(dirname "$0")"
project_root="$(cd ../.. && pwd)"
out_dir="$project_root/resources/bin"
mkdir -p "$out_dir"

swiftc -O main.swift -o "$out_dir/macos-window-info"

echo "built $out_dir/macos-window-info"
