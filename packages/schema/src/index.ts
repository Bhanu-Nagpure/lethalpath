/**
 * The scan-config contract — the one input format everything agrees on.
 *
 * A scan config says what tools an agent holds and which data they can move.
 * `read` means data flows FROM the resource INTO the agent's context. `write`
 * means data flows FROM the context OUT to the resource. The ingest in
 * `@lethalpath/core` turns this into the FLOWS graph that the leak query and
 * `algo.maxFlow` run on.
 *
 * Fixtures under `data/fixtures/` are hand-written configs with declared
 * labels (labelSource "declared", confidence 1). The labeler produces the same
 * shape from a real `mcp.json` with inferred labels ("rule", confidence < 1),
 * so detection quality can be measured separately from graph quality.
 */

export interface ServerDecl {
  id: string;
  name: string;
  source: string;
}

export interface ResourceDecl {
  id: string;
  /** What it is, in words: 'github issue', 'project folder', 'public repo'. */
  kind: string;
  /** Who can put text in it. 'untrusted' = an attacker's sentence can land here. */
  trust?: "untrusted" | "semi" | "trusted";
  /** How bad it is if it leaves. 'private' = must never reach a public sink. */
  sensitivity?: "private" | "internal" | "public";
  /** Where it can go. 'public' = anyone can read the destination. */
  visibility?: "public" | "private";
  /** Locator shown in citations, e.g. 'github.com/acme/notes/issues/42'. */
  scope?: string;
}

export interface ToolDecl {
  /** Unique, always namespaced: 'git.push', 'filesystem.read'. */
  name: string;
  /** ServerDecl id that serves this tool. */
  server: string;
  /** ResourceDecl ids this tool pulls into the context (data flows res -> tool -> context). */
  reads: string[];
  /** ResourceDecl ids this tool can push data to (data flows context -> tool -> res). */
  writes: string[];
  labelSource: "declared" | "rule" | "gold";
  /** 0..1. The UI and reports show this on every edge. */
  labelConf: number;
}

/** A workflow the owner actually runs. The cost model counts tasks a grant serves. */
export interface TaskDecl {
  id: string;
  name: string;
  /** Tool names this task calls. Losing any of them loses the task. */
  uses: string[];
}

export interface ScanConfig {
  id: string;
  title: string;
  note?: string;
  servers: ServerDecl[];
  resources: ResourceDecl[];
  tools: ToolDecl[];
  tasks?: TaskDecl[];
}

/** Ids land in node properties and graph names. Refuse anything else loudly. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function validateScanConfig(cfg: ScanConfig): string[] {
  const problems: string[] = [];
  const check = (what: string, id: string) => {
    if (!ID_PATTERN.test(id)) problems.push(`${what} '${id}' is not a safe id`);
  };
  if (!cfg.id) problems.push("config.id is required");
  else check("config id", cfg.id);

  const serverIds = new Set<string>();
  for (const s of cfg.servers) {
    check("server id", s.id);
    if (serverIds.has(s.id)) problems.push(`duplicate server id '${s.id}'`);
    serverIds.add(s.id);
  }

  const resourceIds = new Set<string>();
  for (const r of cfg.resources) {
    check("resource id", r.id);
    if (resourceIds.has(r.id)) problems.push(`duplicate resource id '${r.id}'`);
    resourceIds.add(r.id);
  }

  const toolNames = new Set<string>();
  for (const t of cfg.tools) {
    check("tool name", t.name);
    if (toolNames.has(t.name)) problems.push(`duplicate tool '${t.name}'`);
    toolNames.add(t.name);
    if (!serverIds.has(t.server)) problems.push(`tool '${t.name}' names unknown server '${t.server}'`);
    for (const r of [...t.reads, ...t.writes]) {
      if (!resourceIds.has(r)) problems.push(`tool '${t.name}' names unknown resource '${r}'`);
    }
    if (t.reads.length === 0 && t.writes.length === 0) {
      problems.push(`tool '${t.name}' moves no data; it cannot be part of a route`);
    }
  }

  const taskIds = new Set<string>();
  for (const task of cfg.tasks ?? []) {
    check("task id", task.id);
    if (taskIds.has(task.id)) problems.push(`duplicate task id '${task.id}'`);
    taskIds.add(task.id);
    for (const tool of task.uses) {
      if (!toolNames.has(tool)) problems.push(`task '${task.id}' uses unknown tool '${tool}'`);
    }
  }
  return problems;
}
