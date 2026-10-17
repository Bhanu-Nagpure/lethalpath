# Submission draft — fill these into the portal

Copy fields from here; replace every TODO before submitting. Keep this file in
sync with what is actually true at submission time.

## One-liner (used verbatim in the portal)

> LethalPath finds every route an AI agent can be tricked into leaking your
> data through its MCP tools, then computes the fewest permissions to revoke
> that close them all — and your workflows keep running.

## Fields

| field | value |
|---|---|
| Project name | LethalPath |
| Public repo | https://github.com/bhanu-dev82/lethalpath |
| Demo video | TODO — public YouTube link, ≤4 min, human voice; script in `docs/DEMO-SCRIPT.md` |
| Live URL / setup | TODO — hosted site URL. The repo ships a manual Pages workflow for `site/`: enable Settings → Pages → Source: GitHub Actions, run the "Pages" workflow once, then it is live at https://bhanu-dev82.github.io/lethalpath/ . Local: `docker compose up -d && pnpm build && node packages/cli/dist/index.js scan` |
| Tracks | T01 — Agents That Act on Connected Data (primary); T02 — Agent Memory and Coordination (the guard's session graph) |
| AI disclosure | `AI_DISCLOSURE.md` in the repo (rule 18) |
| Blog post | TODO — link if published same week |

## Description (long field)

An agent that can read text an attacker controls, read private data, and write
somewhere public can be steered into leaking that data — Simon Willison's
lethal trifecta. Each tool behaves exactly as documented; the bug is in the
arrangement, and the arrangement is a path: untrusted → private → public.

LethalPath models the tool/resource graph in FalkorDB (`scan_*` graph per
config, one `FLOWS` relationship type with capacity = 1 + tasks the grant
serves), finds the routes with a variable-length traversal through the shared
agent context — the "laundering" hop per-server scanners cannot see — and
computes the fix with `CALL algo.maxFlow`, deriving the cheaper of the two
canonical minimum cuts from the residual graph. `fix` then proves itself by
re-running the leak query with the revoked grants excluded: zero rows is the
receipt. `scan --mcp mcp.json` puts the labeler in front of the same pipeline —
a real Claude Desktop config is labelled by rule (unmatched tools named, not
hidden; secrets redacted in values and token-shaped server names alike), then
scanned: the committed demo config yields 567 routes closed by nine
revocations. The 40-case eval (`packages/eval/results/`) passes 40/40 on both
detection and fix quality. A runtime guard (`packages/guard`) blocks the
poisoned call in a live session and allows the same call on a clean one; the
guard's session memory is a second FalkorDB graph (`sessions_*`) that stores
decisions and argument hashes, never content.

## Verify in five minutes

```bash
docker compose up -d && pnpm install && pnpm build && pnpm test   # 53 pass
node packages/cli/dist/index.js scan          # 1 route → fix → 0 of 1
node packages/cli/dist/index.js scan --mcp data/fixtures/mcp-demo.json   # 567 routes
node packages/cli/dist/index.js scan data/fixtures/many-tools.json       # the fallback note
pnpm --filter @lethalpath/guard demo          # blocked call, then an allowed one
pnpm --filter @lethalpath/eval evaluate       # 40/40 both suites
```

Every printed number traces to `packages/eval/results/*.json`, the uncut run in
`docs/live-evidence/`, or the fixture named beside it; the full browser capture
recipe lives in `docs/browser-shots.md`.

## Checklist before hitting submit

- [x] Repo is public and only the product is in it — github.com/bhanu-dev82/lethalpath, full incremental history (no squash)
- [x] CI green on main (`.github/workflows/ci.yml`: build, 53 tests, 40/40 eval, CLI smoke, against a pinned 6.0.2 service container)
- [x] README numbers match `packages/eval/results/*.json` and the evidence log
- [ ] Video is public, not-for-kids, 2–4 minutes, numbers match
- [ ] Site is deployed and the numbers on it match the same JSON files
- [x] `docs/live-evidence/` has a fresh uncut run (2026-10-17T13:52:42Z)
- [x] AI disclosure present and accurate
- [x] Tracks named in the portal exactly as in the README
- [ ] Screenshot the submission confirmation
