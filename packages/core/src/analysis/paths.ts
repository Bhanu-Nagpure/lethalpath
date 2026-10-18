/**
 * The queries LethalPath exists to run: find the modelled routes, count them without
 * a display cap, compute the minimum cut, and prove the fix.
 *
 * All of them ran against FalkorDB 6.0.2 before being committed. The leak
 * query returned the laundering path on the fs+git fixture; the fix query
 * returned a real max-flow. See the test for the expected shape.
 *
 * `algo.maxFlow` on 6.0.2 accepts exactly one relationship type and returns
 * flows, not the cut. The relationship type is therefore `FLOWS` throughout,
 * and the cut itself is computed in mincut.ts from the residual graph.
 *
 * The leak and verify queries anchor at the *injecting* context instead of
 * walking `*2..10` freely: a free walk can re-enter the hub and enumerates
 * exponentially — a 12-tool config made the server time out, while the
 * anchored form finishes in hundreds of milliseconds at 20 tools. Anchoring
 * also tightens the semantics: the route must pass through the tainted
 * context itself, not merely some context.
 */

export const LEAK_PATH = `
MATCH inj = (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})
             -[:FLOWS*1..5]->(ctx)
             -[:FLOWS*1..5]->(s:Resource {visibility:'public'})
RETURN u.kind AS injected_from,
       [n IN nodes(inj) | coalesce(n.kind, n.name, n.id)] AS injection,
       [n IN nodes(leak) | coalesce(n.kind, n.name, n.id)] AS chain,
       [n IN nodes(leak) WHERE n:Tool | n.name] AS tools,
       length(leak) AS hops
ORDER BY hops ASC
LIMIT 25
`.trim();

/**
 * The same traversal, counted instead of listed. LEAK_PATH is capped at 25
 * rows so a display never explodes; this one is not capped, so the CLI can
 * say "25 of 108" instead of quietly meaning it.
 */
export const LEAK_COUNT = `
MATCH (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})
             -[:FLOWS*1..5]->(ctx)
             -[:FLOWS*1..5]->(s:Resource {visibility:'public'})
RETURN count(leak) AS routes
`.trim();

/**
 * The same traversal with the ordering dropped. ORDER BY forces the engine to
 * materialise and sort every walk before the LIMIT can apply, and on graphs
 * where tools chain through the context hub the walk count explodes — a
 * 40-tool config of that shape (fixture: data/fixtures/many-tools.json) blew
 * the server budget on the ordered form while the count, which materialises
 * no path values, stayed comfortably inside it. Without ORDER BY the engine
 * can stop at the LIMIT; `scan` falls back to this when the ordered query
 * fails, and says the order is arbitrary.
 */
export const LEAK_PATH_FAST = `
MATCH inj = (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})
             -[:FLOWS*1..5]->(ctx)
             -[:FLOWS*1..5]->(s:Resource {visibility:'public'})
RETURN u.kind AS injected_from,
       [n IN nodes(inj) | coalesce(n.kind, n.name, n.id)] AS injection,
       [n IN nodes(leak) | coalesce(n.kind, n.name, n.id)] AS chain,
       [n IN nodes(leak) WHERE n:Tool | n.name] AS tools,
       length(leak) AS hops
LIMIT 25
`.trim();

export const MIN_CUT = `
MATCH (p:Resource {sensitivity:'private'})
WHERE p.visibility IS NULL OR p.visibility <> 'public'
WITH collect(p) AS src
MATCH (s:Resource {visibility:'public'})
WHERE s.sensitivity IS NULL OR s.sensitivity <> 'private'
WITH src, collect(s) AS dst
CALL algo.maxFlow({
  sourceNodes: src,
  targetNodes: dst,
  relationshipTypes: ['FLOWS'],
  capacityProperty: 'capacity'
})
YIELD maxFlow, edges, edgeFlows
RETURN maxFlow, edges, edgeFlows
`.trim();

/**
 * The proof that the fix works: the same leak query again, with the revoked
 * grants' edges excluded. Zero rows is the receipt. `$revoked` binds through
 * the CYPHER prefix like every other parameter.
 */
export const VERIFY_FIX = `
MATCH (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})
             -[:FLOWS*1..5]->(ctx)
             -[:FLOWS*1..5]->(s:Resource {visibility:'public'})
WHERE all(rel IN relationships(leak) WHERE rel.grant IS NULL OR NOT (rel.grant IN $revoked))
RETURN count(leak) AS remaining
`.trim();

export interface LeakPath {
  injectedFrom: string;
  /** The injection chain, node by node: issue → github.read → context. */
  injection: string[];
  /** The leaking route, node by node: files → filesystem.read → context → git.push → repo. */
  chain: string[];
  tools: string[];
  hops: number;
}

/** `collect()` over a raw client arrives as a JSON string. Handle both. */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [v];
    } catch {
      return [v];
    }
  }
  return [];
}

/** Rows arrive as objects keyed by column alias, not positional arrays. */
export function parseLeakPaths(rows: Record<string, unknown>[]): LeakPath[] {
  return rows.map((row) => ({
    injectedFrom: String(row["injected_from"] ?? ""),
    injection: asList(row["injection"]),
    chain: asList(row["chain"]),
    tools: asList(row["tools"]),
    hops: Number(row["hops"]),
  }));
}
