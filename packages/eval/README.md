# @lethalpath/eval

The measurement harness behind the README's Results section and the site's
Benchmarks page. It generates 40 scan configs with ground truth known by
construction, runs both suites against a live FalkorDB, and writes the only
files any public number may quote:

- `results/detection.json`
- `results/fix-quality.json`

## The 40 cases (mulberry32, seed 20261017)

16 planted routes · 8 laundering-only · 8 clean · 8 tie. Every generated
config passes `validateScanConfig` before it is used.

- **detection** — each case ingested into its own `eval_det_*` graph and
  scanned with the real `LEAK_PATH`. Pass = planted private/public endpoints
  and the sink tool found; clean cases must return zero paths.
- **fix-quality** — each case in its own `eval_fix_*` graph; the cut comes
  from the real `MIN_CUT` + `cutFromMaxFlow`, then the real `VERIFY_FIX` runs
  with the chosen grants revoked. Pass = cut matches the constructed answer,
  route count is zero, tasks kept as expected (empty cut for clean cases).

The run prints a table per suite, writes both JSON files, and deletes its
`eval_*` graphs afterwards (confirmed by `GRAPH.LIST`).

## Commands

```bash
pnpm --filter @lethalpath/eval build
pnpm --filter @lethalpath/eval evaluate   # rewrites both JSON files, live
```

## Honesty notes

- Minimality of each expected cut is by construction (one private resource,
  one public sink, one reader, one writer per route case — the only
  single-grant cuts are {reader} and {writer}). The live engine agrees on all
  40 cases; this is documented at the top of `src/generate.ts`.
- Laundering cases carry a shorter parallel route through the shared context
  hub by design of the graph model; detection accepts either, and the cut set
  is unchanged. Noted in `src/generate.ts`.
