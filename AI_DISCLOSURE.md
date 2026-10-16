# AI use disclosure

Required by the hackathon rules. This file is the record.

AI coding assistants were used throughout this project for:

- scaffolding and boilerplate;
- drafting documentation, including this file;
- suggesting Cypher, which was then reviewed and run by a human;
- a JSON-schema classifier that proposes trust labels for MCP tools *(planned)*.

The following were done by a human, and can be walked through on request:

- every Cypher query was executed against a live FalkorDB 6.0.2 instance before
  it was committed, and corrected where the documented syntax did not run;
- every number reported anywhere in this repository comes from a file under
  `eval/results/` and was read before it was quoted;
- the hand-labelled gold set of tool trust labels contains no model output;
- the graph model, the decision to model capacity edges as a single relationship
  type, and the choice of product were ours.

## What we got wrong, on purpose

We started by planning an MCP tool router. The pain is real, but the fix does not
need a graph — keyword search and embeddings do it, and it is already shipped.
Under this hackathon's rules a product that still works after removing FalkorDB
is disqualified, so we dropped it. The replacement — finding leak *paths* and the
minimum cut that closes them — fails that test in the other direction: remove the
graph and it stops existing.

We also found documented FalkorDB behaviour that does not run on the pinned image
(a shortest-path index, and a parameter-binding form). We wrote fallbacks and
recorded them in the README rather than quoting benchmarks we could not reproduce.
