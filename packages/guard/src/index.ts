/**
 * @lethalpath/guard — the runtime half of LethalPath.
 *
 * The scan finds the arrangement that leaks. The guard watches a live session
 * and refuses the call that would carry the data out — while the same call on
 * a clean session is allowed, because on a clean session it is just work.
 *
 * Frozen API:
 *
 *   decideCall(cfg, policy, taint, tool)   pure decision, no I/O
 *   class Guard                            session taint + audit append
 *
 * Block rule (frozen): a call to a tool that writes to a resource with
 * visibility 'public' is blocked when the session taint holds BOTH
 * "untrusted" and "private" — and the reason names the route. Deny wins over
 * everything; nothing an allowed call can do bypasses taint.
 */

import { GraphDB } from "@lethalpath/core";
import { ID_PATTERN, validateScanConfig, type ScanConfig } from "@lethalpath/schema";

import { validatePolicy, type Policy } from "./policy.js";
import { explainRoute, publicSinkWrites } from "./route.js";
import { SessionLog } from "./session.js";
import { describeTaint, holdsBoth, labelsForResource } from "./taint.js";

export type Rule = "taint" | "policy-deny" | "default";

export interface Decision {
  decision: "allowed" | "blocked";
  /** Names why, and for a taint block the route that explains it. */
  reason: string;
  rule: Rule;
  /** Node labels of the leak route, when one explains the block. */
  route?: string[];
}

/** Printed verbatim in every taint block; the demo transcript quotes it. */
const WHY =
  "a write to a public sink while the session holds untrusted input and private data";

/**
 * Pure. No I/O, no clock, no config mutation — the whole rule in one place.
 * `taint` is the set of labels the session's context has absorbed so far.
 */
export function decideCall(
  cfg: ScanConfig,
  policy: Policy,
  taint: Set<string>,
  tool: string,
): Decision {
  // Deny short-circuits everything. Seek help before looking at the graph.
  if (policy.deny.includes(tool)) {
    const note = policy.note === undefined ? "" : ` — ${policy.note}`;
    return {
      decision: "blocked",
      rule: "policy-deny",
      reason: `deny list: '${tool}' is refused before any taint check${note}`,
    };
  }

  const decl = cfg.tools.find((candidate) => candidate.name === tool);
  if (decl === undefined) {
    return {
      decision: "allowed",
      rule: "default",
      reason: `'${tool}' is not declared in scan '${cfg.id}'; the guard has no rule for it`,
    };
  }

  const sinks = publicSinkWrites(cfg, tool);
  if (sinks.length === 0) {
    return {
      decision: "allowed",
      rule: "default",
      reason:
        `'${tool}' does not write to a public sink` +
        (taint.size === 0 ? "" : `; taint (${describeTaint(taint)}) cannot leave this way`),
    };
  }

  if (!holdsBoth(taint)) {
    return {
      decision: "allowed",
      rule: "default",
      reason: `writes to a public sink, but the session taint is ${describeTaint(taint)} — the freeze rule needs untrusted AND private`,
    };
  }

  const route = explainRoute(cfg, tool);
  const reason = route === null ? WHY : `${WHY} · route: ${route.join(" → ")}`;
  return route === null
    ? { decision: "blocked", rule: "taint", reason }
    : { decision: "blocked", rule: "taint", reason, route };
}

export interface GuardOptions {
  /** Audit graph suffix: sessions_<sessionId>. Defaults to a time-based id. */
  sessionId?: string;
  /** An already-open GraphDB on sessions_<sessionId>. The caller keeps ownership. */
  db?: GraphDB;
  host?: string;
  port?: number;
}

/**
 * Stateful half: holds the session's taint, decides every call, and appends
 * the decision to sessions_<id>. Reads absorb taint only when a call is
 * allowed — a blocked call moves nothing, so it taints nothing.
 */
export class Guard {
  private readonly taintSet = new Set<string>();
  private readonly cfg: ScanConfig;
  private readonly policy: Policy;
  private readonly given: GraphDB | undefined;
  private readonly host: string;
  private readonly port: number;
  private db: GraphDB | undefined;
  private log: SessionLog | undefined;
  /** Serialises decide() so steps append in call order and taint never races. */
  private tail: Promise<unknown> = Promise.resolve();

  readonly sessionId: string;

  constructor(cfg: ScanConfig, policy: Policy, opts: GuardOptions = {}) {
    const problems = validateScanConfig(cfg);
    if (problems.length > 0) {
      throw new Error(`guard refused a broken config: ${problems.join("; ")}`);
    }
    const policyProblems = validatePolicy(policy);
    if (policyProblems.length > 0) {
      throw new Error(`guard refused a broken policy: ${policyProblems.join("; ")}`);
    }
    this.sessionId = opts.sessionId ?? `guard-${Date.now().toString(36)}`;
    if (!ID_PATTERN.test(this.sessionId)) {
      throw new Error(
        `guard refused session id '${this.sessionId}': must match ${ID_PATTERN.source}`,
      );
    }
    this.cfg = cfg;
    this.policy = policy;
    this.given = opts.db;
    this.db = opts.db;
    this.host = opts.host ?? "localhost";
    this.port = opts.port ?? 6379;
  }

  /** What the context holds right now. Read-only view for reporters. */
  get taint(): ReadonlySet<string> {
    return this.taintSet;
  }

  async decide(tool: string, args?: unknown): Promise<Decision> {
    const run = this.tail.then(
      () => this.decideOnce(tool, args),
      () => this.decideOnce(tool, args),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async decideOnce(tool: string, args?: unknown): Promise<Decision> {
    const decision = decideCall(this.cfg, this.policy, this.taintSet, tool);
    const decl =
      decision.decision === "allowed"
        ? this.cfg.tools.find((candidate) => candidate.name === tool)
        : undefined;
    const reads = decl?.reads ?? [];
    const writes = decl?.writes ?? [];

    const log = await this.writer();
    await log.append({ tool, decision: decision.decision, reason: decision.reason, args, reads, writes });

    for (const resourceId of reads) {
      const resource = this.cfg.resources.find((candidate) => candidate.id === resourceId);
      if (resource === undefined) continue;
      for (const label of labelsForResource(resource)) this.taintSet.add(label);
    }
    return decision;
  }

  private async writer(): Promise<SessionLog> {
    if (this.log !== undefined) return this.log;
    if (this.db === undefined) {
      this.db = await GraphDB.open(`sessions_${this.sessionId}`, this.host, this.port);
    }
    this.log = new SessionLog(this.db, this.sessionId);
    return this.log;
  }

  /** Flush pending appends; close the session graph only if we opened it. */
  async close(): Promise<void> {
    await this.tail;
    if (this.given === undefined && this.db !== undefined) {
      await this.db.close();
    } else if (this.given !== undefined) {
      // The caller owns the connection; just stop pointing at it.
    }
    this.db = undefined;
    this.log = undefined;
  }
}

export { EMPTY_POLICY, loadPolicy, parsePolicy, validatePolicy } from "./policy.js";
export type { Policy } from "./policy.js";
export { explainRoute, publicSinkWrites } from "./route.js";
export { SessionLog, argsHash, canonicalJson } from "./session.js";
export type { StepDecision, StepInput, StepRow } from "./session.js";
export { TAINT_ORDER, describeTaint, holdsBoth, labelsForResource } from "./taint.js";
export type { TaintLabel } from "./taint.js";
