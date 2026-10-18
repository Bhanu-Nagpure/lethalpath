/**
 * Turn a ScanConfig into the FLOWS graph.
 *
 * Ingest is the only writer in the product. It runs in three beats, strictly
 * in order:
 *
 *   1. clear — a re-scan never reads stale edges from the previous run
 *   2. build — every node, then every FLOWS edge, with
 *      capacity = 1 + taskCost so the min-cut prefers the grant that breaks
 *      fewer declared tasks
 *   3. flip (:Meta).ready — always the last write. Readers check it before
 *      analysing, so a scan can never read a half-built graph.
 *
 * Every number in the graph comes from the config file. Nothing is inferred
 * here; producing the config from a real mcp.json is the labeler's job.
 */

import { validateScanConfig, type ScanConfig } from "@lethalpath/schema";

import type { GraphDB } from "./db.js";

export const CONTEXT_ID = "context";
export const HUB_CAPACITY = 1_000_000;

/** One graph per scan config. FalkorDB's multigraph model is the isolation. */
export function scanGraphName(configId: string): string {
  return `scan_${configId}`;
}

/** How many declared tasks call this tool. The cost model's only input. */
export function taskCost(cfg: ScanConfig, toolName: string): number {
  return (cfg.tasks ?? []).filter((t) => t.uses.includes(toolName)).length;
}

function q(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type PropValue = string | number | boolean | undefined;

function props(entries: Array<[string, PropValue]>): string {
  const parts = entries
    .filter((e): e is [string, string | number | boolean] => e[1] !== undefined)
    .map(([k, v]) => `${k}:${typeof v === "string" ? q(v) : String(v)}`);
  return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

export interface IngestPlan {
  statements: string[];
  nodes: number;
  edges: number;
}

/** Pure. Builds the whole graph as Cypher statements, ready for the write. */
export function planIngest(cfg: ScanConfig): IngestPlan {
  const statements: string[] = [];

  for (const s of cfg.servers) {
    statements.push(`CREATE (:Server${props([["id", s.id], ["name", s.name], ["source", s.source]])})`);
  }
  for (const r of cfg.resources) {
    statements.push(
      `CREATE (:Resource${props([
        ["id", r.id],
        ["kind", r.kind],
        ["trust", r.trust],
        ["sensitivity", r.sensitivity],
        ["visibility", r.visibility],
        ["scope", r.scope],
      ])})`,
    );
  }
  for (const t of cfg.tools) {
    statements.push(
      `CREATE (:Tool${props([
        ["id", t.name],
        ["name", t.name],
        ["server", t.server],
        ["labelSource", t.labelSource],
        ["labelConf", t.labelConf],
      ])})`,
    );
  }
  statements.push(`CREATE (:Context${props([["id", CONTEXT_ID]])})`);

  let edges = 0;
  const edge = (statement: string) => {
    edges += 1;
    statements.push(statement);
  };

  for (const t of cfg.tools) {
    edge(
      `MATCH (srv:Server {id:${q(t.server)}}), (t:Tool {name:${q(t.name)}}) ` +
        `CREATE (srv)-[:HOSTS]->(t)`,
    );
  }

  for (const t of cfg.tools) {
    const cost = taskCost(cfg, t.name);
    // Dedupe: a config may name the same resource twice. Two identical FLOWS
    // edges would make algo.maxFlow reject the whole relationship type
    // globally ("contains multi-edges"), killing the fix for the entire scan.
    const reads = [...new Set(t.reads)];
    const writes = [...new Set(t.writes)];
    for (const r of reads) {
      edge(
        `MATCH (r:Resource {id:${q(r)}}), (t:Tool {name:${q(t.name)}}) ` +
          `CREATE (r)-[:FLOWS {dir:'feeds', capacity:${1 + cost}, grant:${q(t.name)}, taskCost:${cost}, revocable:true}]->(t)`,
      );
    }
    for (const r of writes) {
      edge(
        `MATCH (t:Tool {name:${q(t.name)}}), (r:Resource {id:${q(r)}}) ` +
          `CREATE (t)-[:FLOWS {dir:'emits', capacity:${1 + cost}, grant:${q(t.name)}, taskCost:${cost}, revocable:true}]->(r)`,
      );
    }
    if (reads.length > 0) {
      edge(
        `MATCH (t:Tool {name:${q(t.name)}}), (c:Context {id:'context'}) ` +
          `CREATE (t)-[:FLOWS {dir:'emits', capacity:${HUB_CAPACITY}, revocable:false}]->(c)`,
      );
    }
    if (writes.length > 0) {
      edge(
        `MATCH (c:Context {id:'context'}), (t:Tool {name:${q(t.name)}}) ` +
          `CREATE (c)-[:FLOWS {dir:'feeds', capacity:${HUB_CAPACITY}, revocable:false}]->(t)`,
      );
    }
  }

  const nodes = cfg.servers.length + cfg.resources.length + cfg.tools.length + 2;
  statements.push(
    `CREATE (:Meta${props([
      ["id", "scan"],
      ["config", cfg.id],
      ["title", cfg.title],
      ["nodes", nodes],
      ["edges", edges],
      ["ready", true],
    ])})`,
  );

  return { statements, nodes, edges };
}

export interface IngestResult {
  graph: string;
  nodes: number;
  edges: number;
}

/**
 * Clear, rebuild, and only then raise the ready flag. The config is validated
 * first and refusing is loud: a bad id never reaches a Cypher string.
 */
export async function ingest(db: GraphDB, cfg: ScanConfig): Promise<IngestResult> {
  const problems = validateScanConfig(cfg);
  if (problems.length > 0) {
    throw new Error(`scan config rejected:\n- ${problems.join("\n- ")}`);
  }
  const plan = planIngest(cfg);
  await db.write("MATCH (n) DETACH DELETE n");
  for (const statement of plan.statements) {
    await db.write(statement);
  }
  return { graph: scanGraphName(cfg.id), nodes: plan.nodes, edges: plan.edges };
}

export interface ScanStatus {
  ready: boolean;
  config?: string;
  title?: string;
  nodes: number;
  edges: number;
}

/** Readers call this first. No Meta, or ready:false, means: do not analyse. */
export async function scanStatus(db: GraphDB): Promise<ScanStatus> {
  let res: { rows: Record<string, unknown>[] };
  try {
    res = await db.read(`
      MATCH (m:Meta {id:'scan'})
      RETURN m.ready AS ready, m.config AS config, m.title AS title, m.nodes AS nodes, m.edges AS edges
    `);
  } catch (error) {
    // A graph that was never written does not exist server-side; that is
    // "not ready", not a crash.
    if (error instanceof Error && /empty key/i.test(error.message)) {
      return { ready: false, nodes: 0, edges: 0 };
    }
    throw error;
  }
  const row = res.rows[0];
  if (!row) return { ready: false, nodes: 0, edges: 0 };
  return {
    ready: row["ready"] === true,
    config: row["config"] === undefined ? undefined : String(row["config"]),
    title: row["title"] === undefined ? undefined : String(row["title"]),
    nodes: Number(row["nodes"] ?? 0),
    edges: Number(row["edges"] ?? 0),
  };
}
