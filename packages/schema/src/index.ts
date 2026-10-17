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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const TRUST = new Set(["untrusted", "semi", "trusted"]);
const SENSITIVITY = new Set(["private", "internal", "public"]);
const VISIBILITY = new Set(["public", "private"]);

export function validateScanConfig(cfg: ScanConfig): string[] {
  const problems: string[] = [];
  const c = cfg as unknown as Record<string, unknown>;
  const check = (what: string, id: string) => {
    if (!ID_PATTERN.test(id)) problems.push(`${what} '${id}' is not a safe id`);
  };
  const expectString = (what: string, value: unknown): value is string => {
    if (typeof value === "string") return true;
    problems.push(`${what} must be a string (got ${typeName(value)})`);
    return false;
  };
  const expectArray = (what: string, value: unknown): value is unknown[] => {
    if (Array.isArray(value)) return true;
    problems.push(`${what} must be an array (got ${typeName(value)})`);
    return false;
  };

  if (expectString("config id", c["id"])) {
    if (!c["id"]) problems.push("config.id is required");
    else check("config id", c["id"]);
  }
  expectString("config.title", c["title"]);
  if (c["note"] !== undefined) expectString("config.note", c["note"]);

  const serverIds = new Set<string>();
  if (expectArray("config.servers", c["servers"])) {
    for (const raw of c["servers"]) {
      if (!isRecord(raw)) {
        problems.push(`server entry must be an object (got ${typeName(raw)})`);
        continue;
      }
      if (expectString("server id", raw["id"])) {
        check("server id", raw["id"]);
        if (serverIds.has(raw["id"])) problems.push(`duplicate server id '${raw["id"]}'`);
        serverIds.add(raw["id"]);
      }
      if (raw["name"] !== undefined) expectString(`server '${String(raw["id"])}' name`, raw["name"]);
      if (raw["source"] !== undefined) expectString(`server '${String(raw["id"])}' source`, raw["source"]);
    }
  }

  const resourceIds = new Set<string>();
  if (expectArray("config.resources", c["resources"])) {
    for (const raw of c["resources"]) {
      if (!isRecord(raw)) {
        problems.push(`resource entry must be an object (got ${typeName(raw)})`);
        continue;
      }
      const id = raw["id"];
      if (expectString("resource id", id)) {
        check("resource id", id);
        if (resourceIds.has(id)) problems.push(`duplicate resource id '${id}'`);
        resourceIds.add(id);
      }
      const label = `resource '${String(id)}'`;
      if (raw["kind"] !== undefined) expectString(`${label} kind`, raw["kind"]);
      if (raw["scope"] !== undefined) expectString(`${label} scope`, raw["scope"]);
      if (raw["trust"] !== undefined && expectString(`${label} trust`, raw["trust"]) && !TRUST.has(raw["trust"])) {
        problems.push(`${label} trust '${raw["trust"]}' is not one of untrusted|semi|trusted`);
      }
      if (raw["sensitivity"] !== undefined && expectString(`${label} sensitivity`, raw["sensitivity"]) && !SENSITIVITY.has(raw["sensitivity"])) {
        problems.push(`${label} sensitivity '${raw["sensitivity"]}' is not one of private|internal|public`);
      }
      if (raw["visibility"] !== undefined && expectString(`${label} visibility`, raw["visibility"]) && !VISIBILITY.has(raw["visibility"])) {
        problems.push(`${label} visibility '${raw["visibility"]}' is not one of public|private`);
      }
    }
  }

  const toolNames = new Set<string>();
  if (expectArray("config.tools", c["tools"])) {
    for (const raw of c["tools"]) {
      if (!isRecord(raw)) {
        problems.push(`tool entry must be an object (got ${typeName(raw)})`);
        continue;
      }
      const name = raw["name"];
      if (!expectString("tool name", name)) continue;
      check("tool name", name);
      if (toolNames.has(name)) problems.push(`duplicate tool '${name}'`);
      toolNames.add(name);
      if (expectString(`tool '${name}' server`, raw["server"]) && !serverIds.has(raw["server"])) {
        problems.push(`tool '${name}' names unknown server '${raw["server"]}'`);
      }
      const readsRaw = raw["reads"];
      const writesRaw = raw["writes"];
      const readsOk = expectArray(`tool '${name}' reads`, readsRaw);
      const writesOk = expectArray(`tool '${name}' writes`, writesRaw);
      const reads = (readsOk ? readsRaw : []) as unknown[];
      const writes = (writesOk ? writesRaw : []) as unknown[];
      for (const r of [...reads, ...writes]) {
        if (!expectString(`tool '${name}' resource`, r)) continue;
        if (!resourceIds.has(r)) problems.push(`tool '${name}' names unknown resource '${r}'`);
      }
      if (readsOk && writesOk && reads.length === 0 && writes.length === 0) {
        problems.push(`tool '${name}' moves no data; it cannot be part of a route`);
      }
      if (raw["labelSource"] !== undefined) expectString(`tool '${name}' labelSource`, raw["labelSource"]);
      if (raw["labelConf"] !== undefined && typeof raw["labelConf"] !== "number") {
        problems.push(`tool '${name}' labelConf must be a number (got ${typeName(raw["labelConf"])})`);
      }
    }
  }

  const taskIds = new Set<string>();
  if (c["tasks"] !== undefined && expectArray("config.tasks", c["tasks"])) {
    for (const raw of c["tasks"]) {
      if (!isRecord(raw)) {
        problems.push(`task entry must be an object (got ${typeName(raw)})`);
        continue;
      }
      const id = raw["id"];
      if (!expectString("task id", id)) continue;
      check("task id", id);
      if (taskIds.has(id)) problems.push(`duplicate task id '${id}'`);
      taskIds.add(id);
      if (raw["name"] !== undefined) expectString(`task '${id}' name`, raw["name"]);
      const uses = expectArray(`task '${id}' uses`, raw["uses"]) ? raw["uses"] : [];
      for (const tool of uses) {
        if (!expectString(`task '${id}' tool`, tool)) continue;
        if (!toolNames.has(tool)) problems.push(`task '${id}' uses unknown tool '${tool}'`);
      }
    }
  }
  return problems;
}
