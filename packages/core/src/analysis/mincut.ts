/**
 * Turn FalkorDB's max-flow into the set of grants to revoke.
 *
 * `CALL algo.maxFlow` is the sponsor feature this product cannot live without:
 * it returns the flow on each edge, not the cut. The cut — the cheapest set of
 * grants whose removal breaks every leak — is derived here from the residual
 * graph. Without the flow there is no cut, and without FalkorDB there is no flow.
 */

export interface FlowEdge {
  id: number;
  from: number;
  to: number;
  capacity: number;
  grant: string | null;
  revocable: boolean;
}

export interface Cut {
  /** Distinct revocable grants in the cut, cheapest first. */
  grants: string[];
  /** Every original edge that crosses from the source side to the sink side. */
  edges: FlowEdge[];
  maxFlow: number;
}

/**
 * Residual BFS from the source nodes. An edge is in the cut when its tail is
 * still reachable and its head is not — the standard min-cut, restricted to
 * edges that actually carry capacity.
 */
export function minCut(
  sources: number[],
  edges: FlowEdge[],
  flowByEdge: Map<number, number>,
  maxFlow: number,
): Cut {
  const residual = new Map<number, { to: number; cap: number }[]>();
  const add = (from: number, to: number, cap: number) => {
    if (cap <= 1e-9) return;
    const list = residual.get(from) ?? [];
    list.push({ to, cap });
    residual.set(from, list);
  };

  for (const e of edges) {
    const flow = flowByEdge.get(e.id) ?? 0;
    add(e.from, e.to, e.capacity - flow);
    add(e.to, e.from, flow);
  }

  const reachable = new Set<number>();
  const queue = [...sources];
  for (const s of sources) reachable.add(s);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    for (const nxt of residual.get(node) ?? []) {
      if (!reachable.has(nxt.to)) {
        reachable.add(nxt.to);
        queue.push(nxt.to);
      }
    }
  }

  const crossing = edges.filter(
    (e) => e.capacity > 0 && reachable.has(e.from) && !reachable.has(e.to),
  );

  const grants = [...new Set(crossing.filter((e) => e.revocable && e.grant).map((e) => e.grant as string))];

  return { grants, edges: crossing, maxFlow };
}
