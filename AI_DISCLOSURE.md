# AI use disclosure

This file records how AI assistance was used and where a human checked it.

AI coding assistants were used throughout this project for:

- scaffolding and boilerplate;
- drafting documentation, including this file;
- suggesting Cypher, which was then reviewed and run by a human;
- a rules table that proposes trust labels for MCP tools (`packages/labeler`);
  a learned classifier was considered and is not in this build.

The following were done by a human:

- every Cypher query was executed against a live FalkorDB instance before it was
  committed, and corrected where the documented syntax did not run. The pinned
  6.0.2 image is used in CI and compose; one public-README run used the 6.0.1
  module build and is logged as such;
- every number we call a benchmark comes from a file under
  `packages/eval/results/` and was read before it was quoted; transcript
  numbers come from the uncut run log in `docs/live-evidence/`, labeler figures
  from `packages/labeler/gold/labels.csv` and `rules.ts`;
- the gold set under `packages/labeler/gold/labels.csv` was drafted during this
  build to measure the rules table; it is a reviewable fixture for rule quality,
  not a learned model's output, and it is not claimed as independent human
  ground truth;
- the graph model, the decision to model capacity edges as a single relationship
  type, and the choice of product were ours.

## What changed while we built it

We started by planning an MCP tool router. The pain is real, but the fix does not
need a graph — keyword search and embeddings do it, and it is already shipped.
That made it a thin wrapper around a data store, so we dropped it. The
replacement — finding leak *paths* and the minimum cut that closes them — makes
the graph load-bearing: remove it and the product stops existing.

We also found documented FalkorDB behaviour that does not run on the pinned image
(a shortest-path index, and a parameter-binding form). We wrote fallbacks and
recorded them in the README rather than quoting benchmarks we could not reproduce.
