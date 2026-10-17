/**
 * The receipt: FalkorDB's algo.maxFlow, on a live 6.0.2 instance, is what
 * produces the grant we revoke. Remove the database and this test cannot run.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { GraphDB } from "../db.js";
import { MIN_CUT } from "./paths.js";
import { cutFromMaxFlow, type FlowEdge, type MaxFlowRow } from "./mincut.js";

const FIXTURE = `
CREATE (p:Resource {name:'files', sensitivity:'private'})
CREATE (s:Resource {name:'repo', visibility:'public'})
CREATE (t:Tool {name:'git.push'})
CREATE (p)-[:FLOWS {dir:'feeds', capacity:1, grant:'git.push', revocable:true}]->(t)
CREATE (t)-[:FLOWS {dir:'emits', capacity:1, grant:'git.push', revocable:true}]->(s)
`;

test("live FalkorDB max-flow yields the grant to revoke", async (t) => {
  const name = `cut_${Date.now()}`;
  const db = await GraphDB.open(name);
  t.after(() => db.close());
  await db.write(FIXTURE);

  const listed = await db.read(`
    MATCH (a)-[e:FLOWS]->(b)
    RETURN id(e) AS id, id(a) AS fromId, id(b) AS toId,
           e.capacity AS capacity, e.grant AS grant, e.revocable AS revocable
  `);
  const edges: FlowEdge[] = listed.rows.map((row) => ({
    id: Number(row["id"]),
    from: Number(row["fromId"]),
    to: Number(row["toId"]),
    capacity: Number(row["capacity"]),
    grant: row["grant"] == null ? null : String(row["grant"]),
    revocable: Boolean(row["revocable"]),
  }));

  const sources = await db.read(`
    MATCH (p:Resource {sensitivity:'private'}) RETURN id(p) AS id
  `);
  const sourceIds = sources.rows.map((row) => Number(row["id"]));
  const targets = await db.read(`
    MATCH (s:Resource {visibility:'public'}) RETURN id(s) AS id
  `);
  const targetIds = targets.rows.map((row) => Number(row["id"]));

  const flow = await db.read(MIN_CUT);
  const row = flow.rows[0] as unknown as MaxFlowRow;
  assert.ok(row, "algo.maxFlow returned a row");
  assert.equal(row.maxFlow, 1);

  const cut = cutFromMaxFlow(sourceIds, targetIds, edges, row);
  assert.deepEqual(cut.grants, ["git.push"]);
  assert.equal(cut.side, "write");
});
