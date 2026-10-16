/**
 * The two queries LethalPath exists to run.
 *
 * Both were executed against FalkorDB 6.0.2 before being committed. The leak
 * query returned the laundering path on the fs+git fixture; the fix query
 * returned a real max-flow. See the test for the expected shape.
 *
 * `algo.maxFlow` on 6.0.2 accepts exactly one relationship type and returns
 * flows, not the cut. The relationship type is therefore `FLOWS` throughout,
 * and the cut itself is computed in mincut.ts from the residual graph.
 */

export const LEAK_PATH = `
MATCH (u:Resource {trust:'untrusted'})-[:FLOWS]->(:Tool)-[:FLOWS]->(ctx:Context)
MATCH leak = (p:Resource {sensitivity:'private'})-[:FLOWS*2..10]->(s:Resource {visibility:'public'})
WHERE ctx IN nodes(leak)
RETURN u.kind AS injected_from,
       [n IN nodes(leak) WHERE n:Tool | n.name] AS tools,
       length(leak) AS hops
ORDER BY hops ASC
LIMIT 25
`.trim();

export const MIN_CUT = `
MATCH (p:Resource {sensitivity:'private'}) WITH collect(p) AS src
MATCH (s:Resource {visibility:'public'}) WITH src, collect(s) AS dst
CALL algo.maxFlow({
  sourceNodes: src,
  targetNodes: dst,
  relationshipTypes: ['FLOWS'],
  capacityProperty: 'capacity'
})
YIELD maxFlow, edges, edgeFlows
RETURN maxFlow, edges, edgeFlows
`.trim();

export interface LeakPath {
  injectedFrom: string;
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
    tools: asList(row["tools"]),
    hops: Number(row["hops"]),
  }));
}
