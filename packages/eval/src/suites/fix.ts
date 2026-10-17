/**
 * Fix-quality suite: is the grant the engine tells the owner to revoke the
 * one the generator built the case around, and does revoking it actually
 * close the route without breaking more declared tasks than necessary?
 *
 * Per case, on a fresh `eval_fix_<i>_<runid>` graph:
 *   1. ingest, then read the FLOWS edges and the private/public node ids
 *      exactly the way packages/core/src/ingest.test.ts does;
 *   2. run MIN_CUT (CALL algo.maxFlow) and cutFromMaxFlow;
 *   3. re-run VERIFY_FIX with the cut's grants — remaining must be 0;
 *   4. count the declared tasks that call no revoked grant.
 *
 * Pass = grants equal the constructed answer AND the route is closed AND
 * the tasks-kept count matches the construction. Clean cases pass only when
 * the cut is empty. Any mismatch is reported, not smoothed over.
 */

import {
  GraphDB,
  MIN_CUT,
  VERIFY_FIX,
  cutFromMaxFlow,
  ingest,
  type Cut,
  type FlowEdge,
  type MaxFlowRow,
} from "@lethalpath/core";

import type { Case } from "../generate.js";
import type { SuiteFailure, SuiteResult } from "./detection.js";

async function safeClose(db: GraphDB | undefined): Promise<void> {
  if (!db) return;
  try {
    await db.close();
  } catch {
    /* a failed close must not change a case verdict */
  }
}

async function readEdges(db: GraphDB): Promise<FlowEdge[]> {
  return (
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
}

async function cutOf(db: GraphDB): Promise<Cut | undefined> {
  const sourceIds = (
    await db.read(`MATCH (p:Resource {sensitivity:'private'}) RETURN id(p) AS id`)
  ).rows.map((row) => Number(row["id"]));
  const targetIds = (
    await db.read(`MATCH (s:Resource {visibility:'public'}) RETURN id(s) AS id`)
  ).rows.map((row) => Number(row["id"]));
  const edges = await readEdges(db);
  const row = (await db.read(MIN_CUT)).rows[0] as unknown as MaxFlowRow | undefined;
  if (!row) return undefined; // no max-flow row means no flow to cut
  return cutFromMaxFlow(sourceIds, targetIds, edges, row);
}

/** Undefined = pass; a string = the failure reason. */
async function judgeFix(db: GraphDB, c: Case, cut: Cut | undefined): Promise<string | undefined> {
  if (cut === undefined) {
    // algo.maxFlow returned no row. Semantically that is "no flow, empty
    // cut": fine for clean cases, a missing engine answer for route cases.
    if (!c.truth.hasRoute) return undefined;
    return "CALL algo.maxFlow returned no row on a case with a planted route";
  }

  if (!c.truth.hasRoute) {
    if (cut.grants.length === 0) return undefined;
    return `expected an empty cut on a clean case but got [${cut.grants.join(", ")}] (side ${cut.side ?? "?"}, maxFlow ${cut.maxFlow})`;
  }

  const expected = c.truth.expectedGrants;
  const revoked = new Set(cut.grants);
  const sameGrants =
    expected.length === cut.grants.length && expected.every((g) => revoked.has(g));
  const tasksKept = (c.config.tasks ?? []).filter(
    (t) => !t.uses.some((u) => revoked.has(u)),
  ).length;

  const remaining = Number((await db.read(VERIFY_FIX, { revoked: cut.grants })).rows[0]?.["remaining"] ?? -1);

  const reasons: string[] = [];
  if (!sameGrants) {
    reasons.push(
      `cut [${cut.grants.join(", ")}] (side ${cut.side ?? "?"}, maxFlow ${cut.maxFlow}) !== expected [${expected.join(", ")}]`,
    );
  }
  if (remaining !== 0) {
    reasons.push(`route still open: ${remaining} path(s) after revoking [${cut.grants.join(", ")}]`);
  }
  if (tasksKept !== c.truth.expectedTasksKept) {
    reasons.push(
      `tasks kept ${tasksKept} !== expected ${c.truth.expectedTasksKept} after revoking [${cut.grants.join(", ")}]`,
    );
  }
  return reasons.length === 0 ? undefined : reasons.join("; ");
}

export async function runFixSuite(cases: readonly Case[], runId: string): Promise<SuiteResult> {
  const started = Date.now();
  const failures: SuiteFailure[] = [];
  const breakdown: SuiteResult["breakdown"] = {};
  const graphs: string[] = [];
  let passed = 0;

  for (const [i, c] of cases.entries()) {
    const graph = `eval_fix_${i}_${runId}`;
    graphs.push(graph);
    let reason: string | undefined;
    let db: GraphDB | undefined;
    try {
      db = await GraphDB.open(graph);
      await ingest(db, c.config);
      const cut = await cutOf(db);
      reason = await judgeFix(db, c, cut);
    } catch (error) {
      reason = `threw during fix analysis: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await safeClose(db);
    }

    const bucket = (breakdown[c.kind] ??= { cases: 0, passed: 0, failed: 0 });
    bucket.cases += 1;
    if (reason === undefined) {
      passed += 1;
      bucket.passed += 1;
    } else {
      bucket.failed += 1;
      failures.push({ id: c.id, reason });
    }
  }

  return {
    suite: "fix-quality",
    cases: cases.length,
    passed,
    failed: cases.length - passed,
    failures,
    breakdown,
    seconds: (Date.now() - started) / 1000,
    graphs,
  };
}
