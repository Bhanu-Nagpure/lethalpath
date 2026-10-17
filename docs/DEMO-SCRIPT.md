# Demo video script — target 3:30, hard gate 2–4 min

Event rules that are a hard gate: **one unedited live run** (no cuts between a command
and its output), **human voice** (no TTS), **≥ 720p**, public YouTube, "Not for kids".
If a command errors, fix the cause and re-record from the top — do not splice.

## Before recording

```bash
docker compose up -d                 # FalkorDB 6.0.2 — confirm with docker ps
pnpm install
pnpm build
```

- Warm up each command once off-camera so nothing downloads mid-video.
- Terminal: large font, 100+ columns, cleared screen. The first visible thing should be
  the `scan` banner.
- Every number below is printed by the commands themselves; nothing is typed by hand.

## The run — all commands from the repo root

**0:00 · Hook (say it before touching the keyboard).**
"Every MCP tool on this machine is doing its job. The problem is the arrangement — one
tool reads text an attacker controls, one reads your private files, one can write to a
public repo. Individually fine. Together, a leak path. LethalPath finds every route and
the smallest permission change that closes them all. It runs on FalkorDB."

**0:12 · The route.**
```bash
node packages/cli/dist/index.js scan
```
Read the output aloud: "One route, four hops: project folder → filesystem.read → context
→ git.push → public repo. The injection: a GitHub issue → github.read → context. The
shared agent context is where the attack lives — that is a path, not a row, which is
exactly what a graph answers."

**0:50 · The cut.**
```bash
node packages/cli/dist/index.js fix
```
"One `CALL algo.maxFlow` on FalkorDB, then the residual min-cut. max-flow 2 — that number
is the proof no smaller cut exists. Revoke git.push, one grant. Verified: zero of one
routes remain, because the same leak query re-runs without it. Three of four tasks keep
working; the only thing lost is 'publish the changelog'."

**1:40 · A real mcp.json.**
```bash
node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json
```
"A real Claude-style config — GitHub, filesystem, git. Forty tools labelled by rule, zero
unlabelled, secrets stripped before anything left the machine. 567 routes. That is not a
bug report — line up any three popular MCP servers and the arrangement hands an attacker
hundreds of doors."
```bash
node packages/cli/dist/index.js fix --mcp data/fixtures/mcp-demo.json
```
"max-flow 9: every GitHub write plus git.push. All 567 routes verify closed."

**2:35 · The guard — same call, different session.**
```bash
pnpm --filter @lethalpath/guard demo
```
"This is a live MCP session over stdio. It reads the issue — allowed, a read. Reads the
private folder — allowed. Pushes — BLOCKED, with the route in the error. Fresh session,
same push — allowed. The call did not change. The arrangement did."

**3:15 · Nothing to find, and the number.**
```bash
node packages/cli/dist/index.js scan data/fixtures/clean.json
```
"And when a config is clean, it answers zero routes — no false alarms."
```bash
pnpm --filter @lethalpath/eval evaluate
```
"Forty seeded configs with ground truth by construction: detection 40 of 40, fix quality
40 of 40, live on FalkorDB 6.0.2."

**3:40 · Close.**
"FalkorDB is not the database behind this tool — it *is* the analysis: the path query,
the max-flow, the cut, the verification, and the guard's memory of what a session
absorbed. Remove it and the product does not exist."

## If you run long

Cut the eval command (say "forty of forty, twice" over the close instead) or shorten the
mcp fix narration. Never cut the guard demo — the blocked call is the moment judges
remember. Do not edit the recording afterwards.
