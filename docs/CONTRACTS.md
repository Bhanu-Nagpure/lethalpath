# Contracts

Everything that touches more than one package agrees on the shapes below.

## Graph names

One graph per scan: `scan_<config id>` (e.g. `scan_fs-git`). Sessions: `sessions_<id>`.
This is FalkorDB's multigraph model doing tenant isolation — one instance, many graphs.

## The scan graph (`scan_*`)

```
(:Server {id, name, source})-[:HOSTS]->(:Tool)
(:Resource {id, kind, trust?, sensitivity?, visibility?, scope?})
(:Tool {id, name, server, labelSource, labelConf})
(:Context {id:'context'})
(:Meta {id:'scan', config, title, nodes, edges, ready})
```

Every data movement is ONE relationship type, `FLOWS`, because `algo.maxFlow`
accepts exactly one:

| movement | edge | capacity |
|---|---|---|
| tool reads a resource | `(res)-[:FLOWS {dir:'feeds', grant, taskCost, revocable:true}]->(tool)` | `1 + taskCost` |
| tool writes a resource | `(tool)-[:FLOWS {dir:'emits', grant, taskCost, revocable:true}]->(res)` | `1 + taskCost` |
| tool puts data into the context | `(tool)-[:FLOWS {dir:'emits', revocable:false}]->(context)` | `1000000` |
| context hands data to a tool | `(context)-[:FLOWS {dir:'feeds', revocable:false}]->(tool)` | `1000000` |

`grant` is the tool name — the permission you would revoke. `taskCost` is how many
declared tasks call that tool. Structural (context) edges are never cut because
their capacity dwarfs every real cost.

`(:Meta).ready` is set to `true` as the last write of ingest. Readers check it
before running analysis; a scan never reads a half-built graph.

## Fixtures (`data/fixtures/*.json`)

Conform to `ScanConfig` in `@lethalpath/schema` with `labelSource:'declared'`.
Hand-written, synthetic, no real secrets.

## CLI output (authoritative — the demo transcript matches this)

```
lethalpath scan [config]
lethalpath fix  [config]
lethalpath guard --config <config> [--policy policy.json]
```

The authoritative transcripts live in the README ("What scan prints" / "What
fix prints"), copied from real runs. Zero routes prints the abstention line,
not an error — exit 0 either way. `fix` re-runs the leak query with the
revoked grants excluded (`VERIFY_FIX`) and prints `verified … routes remain`;
a non-zero remainder exits 1 and says so loudly.

## Guard session graph (`sessions_*`)

```
(:Session {id, started})-[:STEP]->(:Step {id, ts, tool, decision, reason, argsHash})
(:Step)-[:READ|WROTE]->(:Resource)
```

No content is ever stored — `argsHash` only. Decisions are `allowed` or `blocked`.

## Eval results (`packages/eval/results/*.json`)

`detection.json`, `fix-quality.json`, `runtime.json`. Shape:

```json
{ "suite": "detection", "cases": 40, "passed": 38, "failed": 2,
  "generatedBy": "packages/eval", "note": "one line on the method" }
```

Every number shown on the site or in the README must appear in one of these
files first.
