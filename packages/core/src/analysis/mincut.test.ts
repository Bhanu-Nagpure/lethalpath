/**
 * The min-cut, proven on graphs whose answers are known by hand.
 * No database: this is the arithmetic FalkorDB's flow is fed into.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chooseCut,
  cutFromMaxFlow,
  cutSide,
  minCut,
  sinkSideCut,
  type Cut,
  type FlowEdge,
} from "./mincut.js";

// private --1--> tool --1--> public. Both edges saturated. The source-side cut
// is the first edge, because nothing downstream of it is reachable.
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

// A dumbbell: both edges saturated, so the cut is genuinely ambiguous — one
// canonical cut sits at the source edge, the other at the sink edge.
const dumbbell: FlowEdge[] = [
  { id: 0, from: 0, to: 1, capacity: 2, grant: "files.read", revocable: true, tasksLost: 3 },
  { id: 1, from: 1, to: 2, capacity: 2, grant: "git.push", revocable: true, tasksLost: 0 },
];
const dumbbellFlow = new Map<number, number>([
  [0, 2],
  [1, 2],
]);

test("both canonical cuts close the route", () => {
  assert.deepEqual(minCut([0], dumbbell, dumbbellFlow, 2).grants, ["files.read"]);
  assert.deepEqual(sinkSideCut([2], dumbbell, dumbbellFlow, 2).grants, ["git.push"]);
});

test("the tie-break prefers the cut that breaks fewer tasks", () => {
  const chosen = chooseCut(
    minCut([0], dumbbell, dumbbellFlow, 2),
    sinkSideCut([2], dumbbell, dumbbellFlow, 2),
  );
  assert.deepEqual(chosen.grants, ["git.push"]);
});

test("on a full tie the write side wins, so the read survives", () => {
  const readSide: Cut = {
    grants: ["files.read"],
    edges: [
      { id: 0, from: 0, to: 1, capacity: 1, grant: "files.read", revocable: true, tasksLost: 0 },
    ],
    maxFlow: 1,
  };
  const writeSide: Cut = {
    grants: ["git.push"],
    edges: [
      { id: 1, from: 1, to: 2, capacity: 1, grant: "git.push", revocable: true, tasksLost: 0 },
    ],
    maxFlow: 1,
  };
  assert.deepEqual(chooseCut(readSide, writeSide).grants, ["git.push"]);
});

test("cutSide names the side from the endpoints", () => {
  const a = minCut([0], dumbbell, dumbbellFlow, 2);
  const b = sinkSideCut([2], dumbbell, dumbbellFlow, 2);
  assert.equal(cutSide(a, [0], [2]), "read");
  assert.equal(cutSide(b, [0], [2]), "write");
  assert.equal(cutSide({ grants: [], edges: [], maxFlow: 0 }, [0], [2]), "none");
});

test("zero flow cuts nothing on either side", () => {
  assert.equal(sinkSideCut([2], dumbbell, new Map(), 0).edges.length, 0);
});

test("a revocable min cut beats one with nothing to revoke", () => {
  // The sink-side crossing has a grant; the source-side crossing does not.
  // Ranking by size alone would pick the cut nobody can execute.
  const pair: FlowEdge[] = [
    { id: 0, from: 0, to: 2, capacity: 1, grant: null, revocable: false },
    { id: 1, from: 2, to: 1, capacity: 1, grant: "g_ts", revocable: true },
  ];
  const cut = cutFromMaxFlow([0], [1], pair, {
    maxFlow: 1,
    edges: [{ id: 0 }, { id: 1 }],
    edgeFlows: [1, 1],
  });
  assert.deepEqual(cut.grants, ["g_ts"]);
  assert.equal(cut.side, "write");
});

test("no max-flow row is an empty cut, not a crash", () => {
  const cut = cutFromMaxFlow([0], [1], dumbbell, undefined);
  assert.deepEqual(cut, { grants: [], edges: [], maxFlow: 0, side: "none" });
});
