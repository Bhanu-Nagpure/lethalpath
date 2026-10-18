#!/usr/bin/env bash
# LethalPath live demo — real commands, real output, no fabricated numbers.
#
#   bash scripts/live-demo.sh              # pauses between acts
#   bash scripts/live-demo.sh --no-pause   # continuous run (rehearsal / recording)
#   bash scripts/live-demo.sh --full       # do not trim the long route dump
#
# Requirements: Node >= 20, pnpm 9, and Docker only when FalkorDB is not
# already answering on 127.0.0.1:6379. The script never deletes a graph or a
# container; it only starts the pinned image if nothing is listening.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PAUSE=1
TRIM=1
for arg in "$@"; do
  case "$arg" in
    --no-pause) PAUSE=0 ;;
    --full)     TRIM=0 ;;
    -h|--help)  sed -n '2,13p' "$0"; exit 0 ;;
  esac
done

B=$'\033[1m'; D=$'\033[2m'; C=$'\033[36m'; G=$'\033[32m'; R=$'\033[31m'; O=$'\033[0m'
say()  { printf '\n%s== %s%s\n' "$C$B" "$*" "$O"; }
note() { printf '%s   %s%s\n' "$D" "$*" "$O"; }
pause(){ if [ "$PAUSE" = 1 ]; then printf '\n%s   ↵ Enter for the next act %s' "$D" "$O"; read -r _; fi; }
die()  { printf '\n%s%s%s\n' "$R" "$*" "$O"; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_port() { for _ in $(seq 1 40); do port_open "$1" && return 0; sleep 1; done; return 1; }

run() {
  printf '\n%s$ %s%s\n' "$B" "$*" "$O"
  "$@"
}

# Run a command, print only its first N lines, and say how much was trimmed.
run_head() {
  local keep="$1" label="$2"; shift 2
  printf '\n%s$ %s%s\n' "$B" "$label" "$O"
  local out total
  out="$("$@" 2>&1)"
  printf '%s\n' "$out" | sed -n "1,${keep}p"
  total="$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
  if [ "$total" -gt "$keep" ]; then
    note "... $((total - keep)) more lines — the CLI prints the 25 shortest routes; the graph holds 567."
    note "Rerun with --full to print the whole dump."
  fi
}

command -v node >/dev/null || die "node is not installed (Node >= 20 is required)."
command -v pnpm >/dev/null || die "pnpm is not installed. Run: corepack enable && corepack prepare pnpm@9.15.0 --activate"

say "LethalPath live demo"
printf '  repo   %s\n' "$ROOT"
printf '  node   %s\n' "$(node -v)"
printf '  pnpm   %s\n' "$(pnpm -v)"

if port_open 6379; then
  note "FalkorDB already answering on 127.0.0.1:6379 — using it, not touching containers."
else
  command -v docker >/dev/null || die "FalkorDB is not running and Docker is not installed. Start FalkorDB 6.0.2 on 127.0.0.1:6379, then re-run."
  if docker ps -a --format '{{.Names}}' | grep -qx lethalpath-falkor; then
    docker start lethalpath-falkor >/dev/null
  else
    docker run -d --name lethalpath-falkor -p 6379:6379 -p 3001:3000 falkordb/falkordb:6.0.2 >/dev/null
  fi
  wait_port 6379 || die "FalkorDB did not start answering on 127.0.0.1:6379."
  note "started falkordb/falkordb:6.0.2 — browser on http://localhost:3001"
fi
pause

say "Act 0 · Preflight (already warm on a prepared machine)"
run pnpm install --frozen-lockfile
run pnpm build
pause

say "Act 1 · The leak is a path"
run node packages/cli/dist/index.js scan
pause

say "Act 2 · Compute the cut"
run node packages/cli/dist/index.js fix
pause

say "Act 3 · A real config — github + filesystem + git"
if [ "$TRIM" = 1 ]; then
  run_head 16 "node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json" \
    node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json
else
  run node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json
fi
run node packages/cli/dist/index.js fix --mcp data/fixtures/mcp-demo.json
pause

say "Act 4 · The guard blocks the poisoned push"
run pnpm --filter @lethalpath/guard demo
pause

say "Act 5 · The evidence"
run pnpm --filter @lethalpath/eval evaluate

say "Where this lives"
note "site   https://www.devanshustudios.com/lethalpath/"
note "repo   https://github.com/bhanu-dev82/lethalpath"
note "video  https://www.devanshustudios.com/lethalpath/#demo"
