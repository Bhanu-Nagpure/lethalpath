# Contributing to LethalPath

LethalPath finds every route by which an AI agent can be tricked into leaking
your data across its MCP tools, then computes the fewest permissions to revoke
that close them all. The graph is the product: if a change still works after you
remove FalkorDB, it is out of scope. This file is the shortest path from a
clone to a change that can merge.

## Prerequisites

- **Docker** — `docker compose up -d` starts `falkordb/falkordb:6.0.2` on
  `localhost:6379`; the Browser UI is on `http://localhost:3000`.
- **Node ≥ 20** (`engines` in the root `package.json`; CI uses Node 22).
- **pnpm 9.15.0** (`packageManager` in the root `package.json`). With corepack:
  `corepack enable && corepack prepare pnpm@9.15.0 --activate`.

## Setup

```bash
docker compose up -d    # FalkorDB 6.0.2, pinned by tag — not :latest
pnpm install
pnpm build              # every workspace package, in dependency order
```

Every command talks to `localhost:6379` and fails loudly if nothing answers.

## Running things

```bash
pnpm test                                  # 53 tests, live against FalkorDB
pnpm typecheck                             # tsc --noEmit across the workspaces
pnpm --filter @lethalpath/guard demo       # a live MCP session: the poisoned push is blocked, a clean one is not
pnpm --filter @lethalpath/eval evaluate    # 40 seeded cases → packages/eval/results/*.json
scripts/evidence.sh                        # the uncut run log (see below)
node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json   # label a real MCP config, then scan it
```

The 53 tests break down as: **labeler 8** (rules table against the 50-row gold
set), **core 29** (ingest, the analysis queries and the residual min-cut against
the live engine, the `RO_QUERY` guards), **eval 8** (generator determinism and
ground truth), **guard 8** (decisions, a real stdio end-to-end session, the
audit graph).

`pnpm --filter @lethalpath/eval evaluate` rewrites
`packages/eval/results/detection.json` and `fix-quality.json`. Those files are
the source of record for any public number — commit them only from a run you
actually made.

`scripts/evidence.sh` writes `docs/live-evidence/run-<timestamp>.log`: the
engine image, corpus hashes, the full test output, one real `scan`, one real
`fix`, the abstention, the 40-tool fallback and the `--mcp` demo, in a single
tee'd log. Commit it unmodified — it is the uncut evidence the README and the
site quote, and trimming it defeats the purpose.

Site checks: the static site under `site/` must agree with the repo's numbers.
After touching the site (or a number it prints), run
`node scripts/site-check.mjs`.

## Commits

- Small, imperative subjects: `clamp LIMIT before dispatch`, not "fixed some stuff".
- Say WHAT changed; if a number is involved, name the file it comes from (a
  fixture, `packages/eval/results/*.json`, or `docs/live-evidence/`).
- One logical change per commit; reference the issue it closes when there is one.

## Project rules

- **FalkorDB is the product, not decoration.** The README's removal test is the
  bar: the route, the cut, and the receipt must stop existing without the
  graph. A feature that survives the removal is rejected, not merged.
- **The read-only guard rails are load-bearing.** Reads go through
  `GraphDB.read` (`GRAPH.RO_QUERY`, write keywords refused before dispatch,
  `LIMIT` capped at 100, 3 s deadline). Do not bypass them to make a query
  "work" — fix the query.
- **Fixtures are contracts.** `data/fixtures/*.json` must keep matching
  [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) and the transcripts quoted in the
  README. Behavior changes update the fixture, the evidence log and the docs
  together.
- **No secrets, synthetic data only.** The labeler drops `env` values and
  redacts token-shaped names and URL query strings before anything reaches the
  graph. The guard's session graph stores decisions and a 16-hex argument hash
  — never the arguments. Keep both true.
- **The runtime path holds no model and no credentials.** Only the labeler may
  touch `LLM_API_KEY`, and only at ingest time (see `AI_DISCLOSURE.md`).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the packages fit together
and [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) for the shapes they agree on.
