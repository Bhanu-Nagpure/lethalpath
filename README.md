# LethalPath

**Powered by [FalkorDB](https://www.falkordb.com).** The graph is not a place we
store the answer. It is the answer.

Finds every route by which an AI agent can be tricked into leaking your data
across its MCP servers, then computes the one permission to revoke that closes
them all — without breaking your work.

Built for [Graph Hacks](https://www.wemakedevs.org/hackathons/falkordb)
(WeMakeDevs × FalkorDB, 15–18 Oct 2026). Tracks: **T01** Agents That Act on
Connected Data, **T02** Agent Memory and Coordination.

> This README describes what is built. Sections marked *(planned)* are not yet
> implemented. Numbers appear only once `eval/results/*.json` contains them.

---

## The removal test

Rule 5: if the product still works once FalkorDB is taken out, the graph is
decoration and the entry is ineligible. LethalPath fails that test on purpose.

| What the product does | What runs it | What happens if FalkorDB is removed |
|---|---|---|
| Find the leak path | `MATCH … -[:FLOWS*2..10]->` | There is no path. A list of tools cannot express "through this folder". |
| Choose the permission to revoke | `CALL algo.maxFlow` then a residual cut | There is no flow, so there is no cut. The test `mincut.live.test.ts` cannot run. |
| Refuse a write from the agent | `GRAPH.RO_QUERY` | The server-side rejection is gone. An application regex is not the same guarantee. |

`packages/core/src/analysis/mincut.live.test.ts` is the executable version of
that table. It opens FalkorDB 6.0.2, runs `algo.maxFlow`, and checks the cut.

## The problem

An agent that can read text an attacker controls, read private data, and write
somewhere public can be steered into exfiltrating that data. Each tool behaves
exactly as documented — the bug is in the *arrangement*. Simon Willison calls
this the [lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/).

The arrangement is a path: `untrusted → private → public`. Paths are what graphs
answer, and a vector index cannot.

## Why FalkorDB

Remove it and three things stop existing rather than degrade:

1. **Leak-path discovery** — variable-length traversal over a mixed graph of
   resources, tools and the agent's context, including "laundering" hops through
   a shared folder that per-server scanners cannot see.
2. **The fix** — `CALL algo.maxFlow` on that graph, with grant edges weighted by
   how many tasks they would break, yielding the cheapest cut.
3. **Cross-agent taint** — a traversal over session state, shared across
   processes, so a subagent inherits what its parent has read.

Every read runs on `GRAPH.RO_QUERY`, which the server enforces as read-only.

## Quick start

```bash
docker compose up -d          # FalkorDB 6.0.2, pinned by tag
pnpm install
pnpm --filter core test       # the graph queries, against the live instance
```

*(The scan/fix/guard CLI is planned — see Status.)*

## The graph

One relationship type, because `algo.maxFlow` on 6.0.2 accepts exactly one:

```cypher
(a)-[:FLOWS {dir: 'feeds'|'emits', capacity, revocable, grant}]->(b)
```

The two queries the product depends on:

```cypher
-- the leak path
MATCH (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})-[:FLOWS*2..10]->
             (s:Resource {visibility:'public'})
WHERE ctx IN nodes(leak)
RETURN u.kind AS injected_from,
       [n IN nodes(leak) WHERE n:Tool | n.name] AS tools,
       length(leak) AS hops
ORDER BY hops ASC LIMIT 25

-- the fix (run twice: exfiltration, then ingress; take the cheaper cut)
MATCH (p:Resource {sensitivity:'private'}) WITH collect(p) AS src
MATCH (s:Resource {visibility:'public'})  WITH src, collect(s) AS dst
CALL algo.maxFlow({sourceNodes: src, targetNodes: dst,
                   relationshipTypes: ['FLOWS'], capacityProperty: 'capacity'})
YIELD maxFlow, edges, edgeFlows
RETURN maxFlow, edges, edgeFlows
```

`algo.maxFlow` returns flows, not the cut. The cut is computed from the residual
graph in `packages/core/src/analysis/mincut.ts`, and a live test checks that the
grant it returns came from FalkorDB.

## FalkorDB features this product calls

Not a list of what the database can do. A list of what this repository executes.

| Feature | Where | Why it has to be FalkorDB |
|---|---|---|
| `algo.maxFlow` | `MIN_CUT` in `paths.ts`, consumed by `cutFromMaxFlow` | The fix. One relationship type, verified on 6.0.2. |
| Variable-length `FLOWS*2..10` | `LEAK_PATH` | The laundering hop. A join cannot name "through the context". |
| `GRAPH.RO_QUERY` | `GraphDB.read` | The guard's own reads cannot write, enforced by the server. |
| `id()` | the live cut test | Edge identity for joining flow back onto grants. |
| Pinned image `falkordb/falkordb:6.0.2` | `docker-compose.yml` | The engine we verified, not whatever `:latest` is tomorrow. |

We do **not** claim CCH. It is documented and it is not in 6.0.2. Saying so is
part of using the sponsor honestly.

## Engine facts

Pinned to `falkordb/falkordb:6.0.2`. Verified on that image, not assumed from docs:

- `algo.maxFlow` requires exactly one relationship type and returns flows, not cuts.
- Parameters bind through the `CYPHER k=v` query prefix; the trailing `PARAMS` form
  does not bind.
- JavaScript UDFs require `falkor.register()` and are not restored on restart.
- Shortest-path indexes (CCH) are **not available** in 6.0.2. We do not use them.

## Data

Public and synthetic only. The graph stores capability *labels*, never file
contents, message bodies or credentials. Usernames, where present, are hashed
before ingest. Demo runs use throwaway repositories holding fake secrets.

## AI use

See [`AI_DISCLOSURE.md`](./AI_DISCLOSURE.md).

## Licence

Apache-2.0. See [`LICENSE`](./LICENSE).
