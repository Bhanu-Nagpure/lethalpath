#!/usr/bin/env bash
# The uncut run log behind the README's numbers.
#
# Run from the repo root with FalkorDB up:
#   scripts/evidence.sh
#
# Writes docs/live-evidence/run-<UTC timestamp>.log containing: the engine
# image, corpus hashes, the full test output, and one real scan + fix + the
# abstention, with no edits between the sections. Do not trim the log.

set -uo pipefail

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG="docs/live-evidence/run-${STAMP}.log"
mkdir -p docs/live-evidence

{
  echo "# LethalPath live evidence — ${STAMP}"
  echo
  echo "## FalkorDB container"
  docker ps --format '{{.Names}} {{.Image}}' | grep -i falkor || echo "(container not found)"
  echo
  echo "## Corpus hashes"
  sha256sum data/fixtures/*.json 2>/dev/null || true
  sha256sum packages/eval/results/*.json 2>/dev/null || true
  sha256sum packages/labeler/gold/labels.csv 2>/dev/null || true
  echo
  echo "## Tests (packages/core, against the live instance)"
  (cd packages/core && pnpm test) 2>&1
  echo
  echo "## scan — fs-git"
  node packages/cli/dist/index.js scan 2>&1
  echo
  echo "## fix — fs-git"
  node packages/cli/dist/index.js fix 2>&1
  echo
  echo "## fix — clean (the abstention)"
  node packages/cli/dist/index.js fix data/fixtures/clean.json 2>&1
  echo
  echo "## scan — 40 tools chaining through the shared context (the fallback)"
  node packages/cli/dist/index.js scan data/fixtures/many-tools.json 2>&1
  echo
  echo "## fix — the same 40-tool config"
  node packages/cli/dist/index.js fix data/fixtures/many-tools.json 2>&1
  echo
  echo "## scan — a real mcp.json (labeler in front)"
  node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json 2>&1
  echo
  echo "## fix — the same mcp.json"
  node packages/cli/dist/index.js fix --mcp data/fixtures/mcp-demo.json 2>&1
  echo
  if [ -f packages/guard/scripts/demo.mjs ]; then
    echo "## guard — poisoned session, then a clean one"
    (cd packages/guard && node scripts/demo.mjs) 2>&1
  fi
  echo
  echo "## labeler — gold set agreement"
  pnpm --filter @lethalpath/labeler build 2>&1
  pnpm --filter @lethalpath/labeler test 2>&1
  echo
  echo "## eval — 40 seeded cases, both suites"
  pnpm --filter @lethalpath/eval build 2>&1
  pnpm --filter @lethalpath/eval evaluate 2>&1
} | sed "s#$(pwd)#<repo>#g" | tee "$LOG"

echo
echo "written: $LOG"
