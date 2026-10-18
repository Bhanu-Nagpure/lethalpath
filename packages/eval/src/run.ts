/**
 * The eval orchestrator: generate the cases, run both suites against the
 * live FalkorDB, write results/detection.json and results/fix-quality.json,
 * then delete every `eval_*` graph the run created.
 *
 * Run with:  node dist/run.js   (package script: pnpm evaluate)
 *
 * Every number in the JSON files is computed in this run. The note records
 * the generator (mulberry32), the seed, the mix and the date so anyone can
 * reproduce the exact same set of cases.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { FalkorDB } from "falkordb";

import { DEFAULT_SEED, makeCases, type Case } from "./generate.js";
import { KIND_ORDER, runDetection, type SuiteResult } from "./suites/detection.js";
import { runFixSuite } from "./suites/fix.js";

const SEED = DEFAULT_SEED;
const N = 40;
const HOST = "localhost";
const PORT = 6379;

interface ResultsFile {
  suite: string;
  cases: number;
  passed: number;
  failed: number;
  generatedBy: string;
  note: string;
  breakdown: Record<string, { cases: number; passed: number; failed: number }>;
  failures: { id: string; reason: string }[];
}

function mixText(cases: readonly Case[]): string {
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return KIND_ORDER.map((kind) => `${counts.get(kind) ?? 0} ${kind}`).join(" / ");
}

function noteFor(suite: string, cases: readonly Case[], date: string): string {
  const method =
    suite === "detection"
      ? "each case ingested into a fresh eval_det_* graph and scanned with LEAK_PATH; pass = planted private/public endpoints and sink tool found (zero paths for clean cases)"
      : "each case ingested into a fresh eval_fix_* graph; cut from CALL algo.maxFlow + cutFromMaxFlow, then VERIFY_FIX(revoked=cut.grants) and tasks-kept counted against the declared tasks; pass = cut matches the constructed answer, route closed, tasks kept as expected (empty cut for clean cases)";
  return (
    `Seeded generator (mulberry32, seed ${SEED}; mix ${mixText(cases)}), run live on ${date} ` +
    `against FalkorDB at ${HOST}:${PORT}. Method: ${method}. Every number computed in this run.`
  );
}

function toFile(result: SuiteResult, note: string): ResultsFile {
  return {
    suite: result.suite,
    cases: result.cases,
    passed: result.passed,
    failed: result.failed,
    generatedBy: "packages/eval",
    note,
    breakdown: result.breakdown,
    failures: result.failures,
  };
}

function printSuite(result: SuiteResult): void {
  const verdict = result.failed === 0 ? "ok" : "FAIL";
  console.log(
    `${result.suite.padEnd(12)} cases ${String(result.cases).padStart(3)}  passed ${String(result.passed).padStart(3)}  failed ${String(result.failed).padStart(3)}  ${result.seconds.toFixed(1)}s  ${verdict}`,
  );
  const parts = KIND_ORDER.filter((kind) => result.breakdown[kind]).map((kind) => {
    const b = result.breakdown[kind];
    return `${kind} ${b?.passed}/${b?.cases}`;
  });
  if (parts.length > 0) console.log(`             ${parts.join(" · ")}`);
  for (const failure of result.failures) {
    console.log(`             FAIL ${failure.id}: ${failure.reason}`);
  }
}

/**
 * Delete every `eval_*` graph. GRAPH.LIST (client.list) finds leftovers
 * from crashed runs too; if it is unavailable we fall back to the names
 * this run created.
 */
async function cleanupEvalGraphs(created: string[]): Promise<{ deleted: number; via: string }> {
  const client = await FalkorDB.connect({ socket: { host: HOST, port: PORT } });
  try {
    let names = created;
    let via = "tracked names";
    try {
      const listed = (await client.list()).filter((name) => name.startsWith("eval_"));
      names = [...new Set([...listed, ...created])];
      via = "GRAPH.LIST";
    } catch {
      /* GRAPH.LIST unavailable on this server; tracked names are enough */
    }
    for (const name of names) {
      await client.selectGraph(name).delete();
    }
    return { deleted: names.length, via };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const cases = makeCases(SEED, N);
  const runId = `${started}-${process.pid}`;
  const date = new Date().toISOString().slice(0, 10);

  console.log(`LethalPath eval — seeded generator (mulberry32, seed ${SEED}), ${cases.length} cases (${mixText(cases)})`);
  console.log(`run id ${runId} · FalkorDB ${HOST}:${PORT}`);

  const detection = await runDetection(cases, runId);
  printSuite(detection);
  const fix = await runFixSuite(cases, runId);
  printSuite(fix);

  const outDir = new URL("../results/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    new URL("detection.json", outDir),
    `${JSON.stringify(toFile(detection, noteFor("detection", cases, date)), null, 2)}\n`,
  );
  writeFileSync(
    new URL("fix-quality.json", outDir),
    `${JSON.stringify(toFile(fix, noteFor("fix-quality", cases, date)), null, 2)}\n`,
  );
  console.log(`results written to ${outDir.pathname}detection.json and fix-quality.json`);

  const cleanup = await cleanupEvalGraphs([...detection.graphs, ...fix.graphs]);
  console.log(`cleanup: deleted ${cleanup.deleted} eval_* graph(s) via ${cleanup.via}`);
  console.log(`total wall time: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (detection.failed > 0 || fix.failed > 0) {
    console.log(`FAILURES present: detection ${detection.failed}, fix-quality ${fix.failed} — leaving exit code 1`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("eval run failed:", error);
  process.exitCode = 1;
});
