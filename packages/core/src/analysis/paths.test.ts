/**
 * The fs+git laundering fixture, and the assertion that the leak query finds it.
 *
 * This is the smallest graph that exhibits the bug: a public issue, an agent
 * context, a private folder, and a public repo, joined by three tools. No single
 * tool is dangerous. The path is.
 *
 * Run with FalkorDB up: `pnpm --filter core test`
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { GraphDB } from "../db.js";
import { LEAK_PATH, MIN_CUT, parseLeakPaths } from "./paths.js";

const FIXTURE = `
CREATE (u:Resource {kind:'issue', trust:'untrusted'})
CREATE (ctx:Context {id:'context'})
CREATE (p:Resource {kind:'files', sensitivity:'private'})
CREATE (s:Resource {kind:'repo', visibility:'public'})
CREATE (t1:Tool {name:'github.read'})
CREATE (t2:Tool {name:'filesystem.write'})
CREATE (t3:Tool {name:'git.push'})
CREATE (u)-[:FLOWS {dir:'feeds', capacity:1}]->(t1)
CREATE (t1)-[:FLOWS {dir:'emits', capacity:1000000}]->(ctx)
CREATE (p)-[:FLOWS {dir:'feeds', capacity:1}]->(t2)
CREATE (t2)-[:FLOWS {dir:'emits', capacity:1}]->(ctx)
CREATE (ctx)-[:FLOWS {dir:'feeds', capacity:1}]->(t3)
CREATE (t3)-[:FLOWS {dir:'emits', capacity:1}]->(s)
`;

async function freshGraph(): Promise<GraphDB> {
  const name = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const db = await GraphDB.open(name);
  await db.write(FIXTURE);
  return db;
}

test("leak path crosses three tools through the shared context", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  const res = await db.read(LEAK_PATH);
  const paths = parseLeakPaths(res.rows);

  assert.equal(paths.length, 1, "exactly one leak path on this fixture");
  const [found] = paths;
  assert.ok(found, "path present");
  assert.equal(found.injectedFrom, "issue");
  assert.deepEqual(found.chain, ["files", "filesystem.write", "context", "git.push", "repo"]);
  assert.deepEqual(found.injection, ["issue", "github.read", "context"]);
  assert.deepEqual(found.tools, ["filesystem.write", "git.push"]);
  assert.equal(found.hops, 4);
});

test("max-flow returns a real flow, not an error", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  const res = await db.read(MIN_CUT);
  assert.equal(res.rows.length, 1);
  const maxFlow = Number(res.rows[0]?.["maxFlow"]);
  assert.ok(maxFlow > 0, `expected positive flow, got ${maxFlow}`);
});

test("a write statement is refused before it reaches the server", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  await assert.rejects(() => db.read("CREATE (:Backdoor {n:1})"), /read-only guard/);
});
