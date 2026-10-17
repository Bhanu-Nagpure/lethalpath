/**
 * Detection suite: does LEAK_PATH find exactly the routes the generator
 * planted, and none where it planted none?
 *
 * Every case is ingested into a fresh `eval_det_<i>_<runid>` graph on the
 * live FalkorDB instance — no shared state between cases, and the graph
 * names are handed back to run.ts for cleanup. The pass rule:
 *
 *   - hasRoute true:  at least one returned path must start at the planted
 *     private resource (chain[0] is its kind), end at the planted public
 *     sink (chain[last] is its kind) and name the planted sink tool.
 *   - hasRoute false: zero paths. A path here is a failure to report, not a
 *     fixture to adjust.
 */

import { GraphDB, LEAK_PATH, ingest, parseLeakPaths, type LeakPath } from "@lethalpath/core";

import { plantedRoute, type Case, type CaseKind } from "../generate.js";

export interface SuiteFailure {
  id: string;
  reason: string;
}

export interface SuiteResult {
  suite: string;
  cases: number;
  passed: number;
  failed: number;
  failures: SuiteFailure[];
  breakdown: Record<string, { cases: number; passed: number; failed: number }>;
  seconds: number;
  /** Every graph this suite created, for cleanup after the last suite. */
  graphs: string[];
}

async function safeClose(db: GraphDB | undefined): Promise<void> {
  if (!db) return;
  try {
    await db.close();
  } catch {
    /* a failed close must not change a case verdict */
  }
}

/** Undefined = pass; a string = the failure reason. */
export function judgeDetection(c: Case, paths: LeakPath[]): string | undefined {
  if (!c.truth.hasRoute) {
    if (paths.length === 0) return undefined;
    const sample = paths
      .slice(0, 3)
      .map((p) => p.chain.join(" -> "))
      .join(" | ");
    return `expected no route but found ${paths.length} path(s): ${sample}`;
  }
  const planted = plantedRoute(c.config);
  if (!planted) {
    return "generator invariant broken: route case without one private resource, one public sink, one reader and one writer";
  }
  const wantFirst = planted.privateResource.kind;
  const wantLast = planted.publicResource.kind;
  const wantTool = planted.writer;
  const matched = paths.filter((p) => {
    const first = p.chain[0];
    const last = p.chain[p.chain.length - 1];
    return first === wantFirst && last === wantLast && p.tools.includes(wantTool);
  });
  if (matched.length > 0) return undefined;
  const got =
    paths.length === 0
      ? "no paths returned"
      : `${paths.length} path(s), none matching: ` +
        paths
          .slice(0, 3)
          .map((p) => `[${p.chain.join(" -> ")}] tools=[${p.tools.join(",")}]`)
          .join(" | ");
  return `planted route (${wantFirst} -> ... -> ${wantLast} via ${wantTool}) not found; ${got}`;
}

export async function runDetection(cases: readonly Case[], runId: string): Promise<SuiteResult> {
  const started = Date.now();
  const failures: SuiteFailure[] = [];
  const breakdown: SuiteResult["breakdown"] = {};
  const graphs: string[] = [];
  let passed = 0;

  for (const [i, c] of cases.entries()) {
    const graph = `eval_det_${i}_${runId}`;
    graphs.push(graph);
    let reason: string | undefined;
    let db: GraphDB | undefined;
    try {
      db = await GraphDB.open(graph);
      await ingest(db, c.config);
      const paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
      reason = judgeDetection(c, paths);
    } catch (error) {
      reason = `threw during scan: ${error instanceof Error ? error.message : String(error)}`;
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
    suite: "detection",
    cases: cases.length,
    passed,
    failed: cases.length - passed,
    failures,
    breakdown,
    seconds: (Date.now() - started) / 1000,
    graphs,
  };
}

/** Kind order used by the console table; kept here so both suites agree. */
export const KIND_ORDER: CaseKind[] = ["leak", "laundering", "clean", "tie"];
