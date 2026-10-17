/**
 * Session audit log — the sessions_<id> graph.
 *
 * One graph per session, the same FalkorDB multigraph isolation the scan
 * graph uses (one instance, many graphs). Every decision appends a Step, and
 * Steps point at the Resource node ids the config declares:
 *
 *   (:Session {id, started})-[:STEP]->(:Step {id, ts, tool, decision, reason, argsHash})
 *   (:Step)-[:READ|WROTE]->(:Resource {id})
 *
 * No content is ever stored. Not the message, not the file, not the
 * arguments — a sha256 of the canonical JSON, truncated to 16 hex chars. The
 * audit proves WHAT was called and WHY it was judged, never the data. The
 * hash still makes runs comparable: same args, same hash.
 *
 * This is the product's own write path. The read path stays behind
 * GraphDB.read (RO_QUERY, LIMIT 100, 3 s, write keywords refused).
 */

import { createHash } from "node:crypto";

import type { GraphDB } from "@lethalpath/core";

export type StepDecision = "allowed" | "blocked";

export interface StepInput {
  tool: string;
  decision: StepDecision;
  reason: string;
  /** Canonicalised, hashed, thrown away. Never stored verbatim. */
  args?: unknown;
  /** Resource ids the call actually read (allowed reads only). */
  reads?: string[];
  /** Resource ids the call actually wrote (allowed writes only). */
  writes?: string[];
}

export interface StepRow {
  id: string;
  ts: number;
  argsHash: string;
}

/** Deterministic JSON: object keys sorted, so equal args always hash equal. */
export function canonicalJson(value: unknown): string {
  return stable(value);
}

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

/** sha256 hex, first 16 chars — the only representation of args that survives. */
export function argsHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args ?? null)).digest("hex").slice(0, 16);
}

export class SessionLog {
  private steps = 0;
  private readonly startedAt: number;

  constructor(
    private readonly db: GraphDB,
    readonly sessionId: string,
  ) {
    this.startedAt = Date.now();
  }

  async append(step: StepInput): Promise<StepRow> {
    this.steps += 1;
    let hash: string;
    try {
      hash = argsHash(step.args);
    } catch {
      // A hostile payload can nest deeper than the stack allows. The step is
      // still audited — the attempt must leave a record — with a hash that
      // says the arguments could not be canonicalised.
      hash = "unhashable";
    }
    const row: StepRow = {
      id: `${this.sessionId}-step-${this.steps}`,
      ts: Date.now(),
      argsHash: hash,
    };
    await this.db.write(
      `MERGE (s:Session {id: $sessionId}) ON CREATE SET s.started = $started
       CREATE (st:Step {id: $stepId, ts: $ts, tool: $tool, decision: $decision, reason: $reason, argsHash: $argsHash})
       CREATE (s)-[:STEP]->(st)
       FOREACH (rid IN $reads | MERGE (r:Resource {id: rid}) CREATE (st)-[:READ]->(r))
       FOREACH (wid IN $writes | MERGE (r:Resource {id: wid}) CREATE (st)-[:WROTE]->(r))`,
      {
        sessionId: this.sessionId,
        started: this.startedAt,
        stepId: row.id,
        ts: row.ts,
        tool: step.tool,
        decision: step.decision,
        reason: step.reason,
        argsHash: row.argsHash,
        reads: step.reads ?? [],
        writes: step.writes ?? [],
      },
    );
    return row;
  }
}
