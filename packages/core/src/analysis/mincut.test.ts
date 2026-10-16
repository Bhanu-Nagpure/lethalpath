/**
 * The min-cut, proven on a graph whose answer is known by hand.
 * No database: this is the arithmetic FalkorDB's flow is fed into.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { minCut, type FlowEdge } from "./mincut.js";

// private --1--> tool --1--> public. Both edges saturated. The cut is the
// first edge, because nothing downstream of it is reachable in the residual.
const edges: FlowEdge[] = [
  { id: 0, from: 0, to: 2, capacity: 1, grant: "filesystem.write", revocable: true },
  { id: 1, from: 2, to: 1, capacity: 1, grant: "git.push", revocable: true },
];
const flow = new Map<number, number>([
  [0, 1],
  [1, 1],
]);

test("saturated path cuts at the source edge", () => {
  const cut = minCut([0], edges, flow, 1);
  assert.equal(cut.maxFlow, 1);
  assert.deepEqual(cut.grants, ["filesystem.write"]);
  assert.equal(cut.edges.length, 1);
});

test("a structural edge with spare capacity is not the cut", () => {
  const wide: FlowEdge[] = [
    { id: 0, from: 0, to: 2, capacity: 1, grant: "git.push", revocable: true },
    { id: 1, from: 2, to: 1, capacity: 1_000_000, grant: null, revocable: false },
  ];
  const cut = minCut([0], wide, new Map([[0, 1], [1, 1]]), 1);
  assert.deepEqual(cut.grants, ["git.push"]);
  assert.ok(cut.edges.every((e) => e.revocable));
});

test("no flow means no cut", () => {
  const cut = minCut([0], edges, new Map(), 0);
  assert.deepEqual(cut.grants, []);
  assert.equal(cut.edges.length, 0);
});
