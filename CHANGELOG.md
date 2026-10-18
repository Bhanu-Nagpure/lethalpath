# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions track the
workspace `package.json`s (all `0.0.1`). Every number below names the file it
came from.

## [Unreleased]

### Added

- **CLI** (`@lethalpath/cli`) — `scan` reads a scan config, builds the graph in
  FalkorDB and lists the routes an attacker could take (untrusted input →
  private data → public sink); `fix` runs `CALL algo.maxFlow`, derives the
  residual min-cut and revokes the computed cut that closes the route set, then
  re-runs the leak query as its own receipt (`VERIFY_FIX`). Configs come from
  `data/fixtures/*.json` or a real MCP config with `--mcp`; `--json` on both
  verbs. Exit 0 for an abstention, 1 for a refusal.
- **Labeler** (`@lethalpath/labeler`) — a rules table turns an `mcp.json` into
  a validated `ScanConfig`: unmatched tools are **named, not hidden**, `env`
  values are dropped and token-shaped names and URL query strings are redacted
  before anything reaches the graph, and malformed input is refused loudly, by
  name. Consumed by `scan --mcp` — the committed `data/fixtures/mcp-demo.json`
  scans to 567 routes closed by 9 revocations (transcript in the README).
- **Guard** (`@lethalpath/guard`) — an MCP stdio server fronting a live
  session. `decideCall` is pure; a write to a public sink is blocked while the
  session holds untrusted input *and* private data, and the refusal names the
  route. Every decision is appended to a per-session FalkorDB graph
  (`sessions_<id>`): decisions, reasons, and a 16-hex argument hash — never the
  arguments themselves.
- **Eval** (`@lethalpath/eval`) — 40 seeded cases (mulberry32, seed 20261017;
  16 leak / 8 laundering / 8 clean / 8 tie), both suites against a live
  FalkorDB 6.0.2: 40/40 detection and 40/40 fix-quality. Source of record:
  `packages/eval/results/detection.json` and
  `packages/eval/results/fix-quality.json`; re-run with
  `pnpm --filter @lethalpath/eval evaluate`.
- **Dense-graph fallback** — on a hub-heavy config shaped like
  `data/fixtures/many-tools.json`, the ordered leak query can exceed the
  server budget; `scan` retries with the unordered `LEAK_PATH_FAST` traversal
  and says the order is arbitrary. The count and the cut are unaffected, and
  the fixture's transcript in `docs/live-evidence/` ends with 0 routes
  remaining.
- **Measurement and evidence** — the live-evidence run log
  (`scripts/evidence.sh` → `docs/live-evidence/run-*.log`, uncut), the 53-test
  workspace suite (labeler 8, core 29, eval 8, guard 8), and the eval results
  committed alongside it.
- **Browser captures** — FalkorDB Browser views of the two demo graphs under
  `docs/` (`browser-scan-fs-git.png`, `browser-scan-mcp.png`), taken
  read-only via `GRAPH.RO_QUERY`; the exact capture recipe is in
  `docs/browser-shots.md`.

## [0.0.1] - 2026-10-16

First public preview: the `scan`/`fix` CLI, the labeler, the guard, and the
eval harness, all pinned to `falkordb/falkordb:6.0.2`. The README carries the
graph model, the load-bearing-graph table, and the transcripts.
