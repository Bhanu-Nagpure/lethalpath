/**
 * Ingest and the two queries, against a live FalkorDB 6.0.2.
 *
 * These tests build the graph from the actual fixture files the CLI scans, so
 * a fixture that stops producing the documented route fails the build.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ScanConfig } from "@lethalpath/schema";

import { GraphDB } from "./db.js";
import { ingest, scanStatus } from "./ingest.js";
import { LEAK_PATH, MIN_CUT, VERIFY_FIX, parseLeakPaths } from "./analysis/paths.js";
import { cutFromMaxFlow, type FlowEdge, type MaxFlowRow } from "./analysis/mincut.js";

function fixture(name: string): ScanConfig {
  const url = new URL(`../../../data/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ScanConfig;
}

async function scanOf(cfg: ScanConfig): Promise<GraphDB> {
  const db = await GraphDB.open(`t_${cfg.id}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  await ingest(db, cfg);
  return db;
}

test("ingest builds the fs-git graph and raises the ready flag", async (t) => {
  const db = await scanOf(fixture("fs-git"));
  t.after(() => db.close());
  const status = await scanStatus(db);
  assert.equal(status.ready, true);
  assert.equal(status.nodes, 11);
  assert.equal(status.edges, 9);
});

test("the leak query names the route tool by tool, on a graph ingest built", async (t) => {
  const db = await scanOf(fixture("fs-git"));
  t.after(() => db.close());
  const paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
  assert.equal(paths.length, 1);
  const [found] = paths;
  assert.ok(found, "path present");
  assert.deepEqual(found.chain, ["project folder", "filesystem.read", "context", "git.push", "public repo"]);
  assert.deepEqual(found.injection, ["github issue", "github.read", "context"]);
  assert.equal(found.injectedFrom, "github issue");
  assert.deepEqual(found.tools, ["filesystem.read", "git.push"]);
  assert.equal(found.hops, 4);
});

test("a live max-flow cuts the write side: revoke git.push, cost one task", async (t) => {
  const db = await scanOf(fixture("fs-git"));
  t.after(() => db.close());

  const sourceIds = (
    await db.read(`MATCH (p:Resource {sensitivity:'private'}) RETURN id(p) AS id`)
  ).rows.map((row) => Number(row["id"]));
  const targetIds = (
    await db.read(`MATCH (s:Resource {visibility:'public'}) RETURN id(s) AS id`)
  ).rows.map((row) => Number(row["id"]));

  const edges: FlowEdge[] = (
    await db.read(`
      MATCH (a)-[e:FLOWS]->(b)
      RETURN id(e) AS id, id(a) AS fromId, id(b) AS toId, e.capacity AS capacity,
             e.grant AS grant, e.revocable AS revocable, e.taskCost AS taskCost
    `)
  ).rows.map((row) => ({
    id: Number(row["id"]),
    from: Number(row["fromId"]),
    to: Number(row["toId"]),
    capacity: Number(row["capacity"]),
    grant: row["grant"] == null ? null : String(row["grant"]),
    revocable: row["revocable"] === true,
    tasksLost: Number(row["taskCost"] ?? 0),
  }));

  const row = (await db.read(MIN_CUT)).rows[0] as unknown as MaxFlowRow;
  assert.ok(row, "algo.maxFlow returned a row");
  const cut = cutFromMaxFlow(sourceIds, targetIds, edges, row);

  assert.deepEqual(cut.grants, ["git.push"]);
  assert.equal(cut.side, "write");
  assert.equal(
    cut.edges.reduce((sum, e) => sum + (e.tasksLost ?? 0), 0),
    1,
    "one declared task uses git.push",
  );

  const before = Number(
    (await db.read(VERIFY_FIX, { revoked: [] })).rows[0]?.["remaining"] ?? -1,
  );
  assert.equal(before, 1, "nothing revoked yet: the route is still there");
  const remaining = Number(
    (await db.read(VERIFY_FIX, { revoked: cut.grants })).rows[0]?.["remaining"] ?? -1,
  );
  assert.equal(remaining, 0, "revoking git.push must close the route");
});

test("an agent that can read but not publish gets the abstention, not a guess", async (t) => {
  for (const name of ["github-only", "clean"]) {
    const db = await scanOf(fixture(name));
    t.after(() => db.close());
    const paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
    assert.equal(paths.length, 0, `${name} must have no route`);
  }
});

test("a hostile config id never reaches a Cypher string", async (t) => {
  const hostile: ScanConfig = {
    ...fixture("clean"),
    id: "x'); MATCH (n) DETACH DELETE n; //",
  };
  const db = await GraphDB.open(`t_hostile_${Date.now()}`);
  t.after(() => db.close());
  await assert.rejects(() => ingest(db, hostile), /scan config rejected/);
  assert.equal((await scanStatus(db)).ready, false);
});
