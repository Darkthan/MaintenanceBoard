#!/bin/sh
set -eu

tmp_dir="$(mktemp -d)"
tmp_msi="$tmp_dir/agent.msi"
trap 'rm -rf "$tmp_dir"' EXIT
node - "$tmp_msi" <<'NODE'
const fs = require('fs');
const { buildAgentMsi } = require('./src/utils/buildAgentMsi');
buildAgentMsi('https://board.example', 'test-token-123')
  .then(buffer => fs.writeFileSync(process.argv[2], buffer))
  .catch(error => { console.error(error); process.exitCode = 1; });
NODE
msiinfo export "$tmp_msi" Property | grep -q 'https://board.example'
msiinfo export "$tmp_msi" Property | grep -q 'test-token-123'
mkdir -p "$tmp_dir/extracted"
msiextract -C "$tmp_dir/extracted" "$tmp_msi" >/dev/null
extracted_agent="$(find "$tmp_dir/extracted" -name agent.ps1 -type f -print -quit)"
test -n "$extracted_agent"
cmp "$extracted_agent" downloads/templates/agent.ps1
echo 'MSI personalization OK'
