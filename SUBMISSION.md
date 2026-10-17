# Submission draft — fill these into the portal

Copy fields from here; replace every TODO before submitting. Keep this file in
sync with what is actually true at submission time.

## One-liner (used verbatim in the portal)

> LethalPath finds every route an AI agent can be tricked into leaking your
> data through its MCP tools, then computes the one permission to revoke that
> closes them all — and your workflows keep running.

## Fields

| field | value |
|---|---|
| Project name | LethalPath |
| Public repo | TODO — public GitHub URL (only `lethalpath/` is tracked) |
| Demo video | TODO — public YouTube link, ≤4 min, human voice |
| Live URL / setup | TODO — hosted site URL, plus `docker compose up -d && pnpm build && node packages/cli/dist/index.js scan` |
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
receipt. A runtime guard (`packages/guard`) blocks the poisoned call in a live
session and allows the same call on a clean one; the guard's session memory is
a second FalkorDB graph (`sessions_*`) that stores decisions and argument
hashes, never content.

## Checklist before hitting submit

- [ ] Repo is public and only the product is in it
- [ ] README numbers match `packages/eval/results/*.json`
- [ ] Video is public, not-for-kids, 2–4 minutes, numbers match
- [ ] Site is deployed and the numbers on it match the same JSON files
- [ ] `docs/live-evidence/` has a fresh uncut run
- [ ] AI disclosure present and accurate
- [ ] Tracks named in the portal exactly as in the README
- [ ] Screenshot the submission confirmation
