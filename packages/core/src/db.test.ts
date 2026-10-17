/**
 * The guard in front of every read, proven against the live server.
 *
 * The audit found the first version refused legitimate reads whose *data*
 * contained words like "delete", and let a LIMIT inside a string masquerade
 * as the real cap. These tests pin the fixed behaviour: structure is checked,
 * data is not; nothing that is a write can pass; nothing that is a read gets
 * refused.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ScanConfig } from "@lethalpath/schema";

import { GraphDB } from "./db.js";
import { ingest } from "./ingest.js";
import { VERIFY_FIX } from "./analysis/paths.js";

function fixture(name: string): ScanConfig {
  const url = new URL(`../../../data/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ScanConfig;
}

async function freshGraph(): Promise<GraphDB> {
  const db = await GraphDB.open(`t_db_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  // A graph that was never written answers reads with "Invalid graph operation
  // on empty key" on 6.0.2, so seed the key the way a scan would.
  await db.write("CREATE (:Meta {seed:true})");
  return db;
}

test("data that contains write words is not refused", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  await assert.doesNotReject(() => db.read("RETURN 'the set of tools' AS s"));
  await assert.doesNotReject(() => db.read("RETURN $name AS name", { name: "file.delete" }));
  await assert.doesNotReject(() => db.read("RETURN 'drop me' AS s // delete comment"));
});

test("a parameter that names a write tool still reads", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  await ingest(db, fixture("clean"));
  const res = await db.read(VERIFY_FIX, { revoked: ["docs.publish", "file.delete"] });
  assert.equal(res.rows.length, 1, "the query ran; zero is a valid answer");
});

test("a write statement is still refused before dispatch", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  await assert.rejects(() => db.read("CREATE (n:Backdoor)"), /write keyword in query/);
  await assert.rejects(() => db.read("MATCH (n) DETACH DELETE n"), /write keyword in query/);
});

test("a hostile parameter key is refused, not concatenated", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  await assert.rejects(
    () => db.read("RETURN 1 AS one", { "x=1 RETURN 42 AS hacked //": 1 }),
    /parameter key 'x=1 RETURN 42 AS hacked \/\/' is not a valid identifier/,
  );
});

test("the cap does not corrupt literals and still bounds rows", async (t) => {
  const db = await freshGraph();
  t.after(() => db.close());
  const res = await db.read("UNWIND range(1,500) AS x WITH x, 'limit 2' AS note RETURN x, note");
  assert.equal(res.rows.length, 100, "rows are capped");
  assert.equal(res.rows[0]?.["note"], "limit 2", "the string is untouched");

  const clamped = await db.read("UNWIND range(1,500) AS x RETURN x LIMIT 400");
  assert.equal(clamped.rows.length, 100, "an oversized LIMIT is clamped");

  const trailing = await db.read("UNWIND range(1,150) AS x RETURN x // note");
  assert.equal(trailing.rows.length, 100, "a trailing comment cannot swallow the cap");

  const small = await db.read("UNWIND range(1,500) AS x RETURN x LIMIT 7");
  assert.equal(small.rows.length, 7, "a small LIMIT is left alone");
});
