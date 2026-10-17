/**
 * Seeded scan-config generator with construction-level ground truth.
 *
 * Every case is built from templates whose minimal cuts are known by
 * construction, not by running the engine:
 *
 *   - leak / tie (4-hop route): u(untrusted) -> U -> ctx, and
 *     p(private) -> reader -> ctx -> writer -> s(public).
 *     Every path out of the one private resource crosses `reader`; every
 *     path into the one public sink crosses `writer`. The only single-grant
 *     cuts are therefore {reader} and {writer}; capacity is
 *     1 + (declared tasks that call the tool), so the cheaper grant wins and
 *     the documented tie-break picks the write side.
 *
 *   - laundering (8-hop route): the private read and the public write are
 *     joined by an intermediate store, so the data round-trips the shared
 *     context between two different tools:
 *     p -> reader -> ctx -> storeWriter -> q -> storeReader -> ctx -> writer -> s.
 *     Because ingest also feeds the context straight into every writing tool,
 *     a shorter 4-hop route through the shared context exists in parallel;
 *     the cut candidates remain {reader} and {writer} and the store chain
 *     only widens the graph.
 *
 *   - clean: the private->public link is missing on exactly one side (no
 *     reader of any private resource, or no writer of any public resource),
 *     so the max flow is zero and the minimal cut is empty.
 *
 * Nothing here reads the engine's output. Ground truth is the placement of
 * the edges plus the declared task lists.
 */

import { validateScanConfig, type ResourceDecl, type ScanConfig, type ServerDecl, type TaskDecl, type ToolDecl } from "@lethalpath/schema";

import { makeRng, type Rng } from "./rng.js";

export type CaseKind = "leak" | "laundering" | "clean" | "tie";

export interface CaseTruth {
  hasRoute: boolean;
  /** The grants the documented fix must revoke (cheaper side, tie -> write side). */
  expectedGrants: string[];
  /** Declared tasks that do not call any revoked grant. */
  expectedTasksKept: number;
  expectedTasksTotal: number;
}

export interface Case {
  id: string;
  kind: CaseKind;
  config: ScanConfig;
  truth: CaseTruth;
}

export interface PlantedRoute {
  privateResource: ResourceDecl;
  publicResource: ResourceDecl;
  /** The only tool that reads the private resource. */
  reader: string;
  /** The only tool that writes the public sink. */
  writer: string;
}

export const DEFAULT_SEED = 20261017;
export const DEFAULT_N = 40;

/* ------------------------------------------------------------------ pools */

interface ServerBase {
  id: string;
  name: string;
}

const INTAKE_SERVERS: ServerBase[] = [
  { id: "issues", name: "GitHub Issues MCP" },
  { id: "inbox", name: "Email MCP" },
  { id: "forum", name: "Community Forum MCP" },
  { id: "tickets", name: "Helpdesk MCP" },
  { id: "feeds", name: "RSS MCP" },
];

const PRIVATE_SERVERS: ServerBase[] = [
  { id: "fs", name: "Filesystem MCP" },
  { id: "warehouse", name: "Warehouse MCP" },
  { id: "crm", name: "CRM MCP" },
  { id: "drive", name: "Drive MCP" },
];

const PUBLISH_SERVERS: ServerBase[] = [
  { id: "git", name: "Git MCP" },
  { id: "pages", name: "Pages MCP" },
  { id: "buckets", name: "Object Storage MCP" },
  { id: "blog", name: "Blog MCP" },
];

const INTERNAL_SERVERS: ServerBase[] = [
  { id: "wiki", name: "Wiki MCP" },
  { id: "notes", name: "Notes MCP" },
  { id: "stage", name: "Staging MCP" },
];

const UNTRUSTED_KINDS = [
  "github issue",
  "forum post",
  "incoming email",
  "support ticket",
  "chat message",
];

const PRIVATE_KINDS = [
  "project folder",
  "customer records",
  "design docs",
  "billing export",
  "research notes",
];

const PUBLIC_KINDS = [
  "public repo",
  "status page",
  "public bucket",
  "company blog",
  "public dashboard",
];

const INTERNAL_KINDS = ["internal wiki", "staging bucket", "draft folder", "shared drive folder"];

const READ_TOOL_NAMES = [
  "files.read",
  "crm.read",
  "docs.read",
  "warehouse.read",
  "drive.read",
  "issues.read",
  "tickets.read",
  "inbox.read",
];

const WRITE_TOOL_NAMES = [
  "git.push",
  "pages.publish",
  "buckets.put",
  "blog.post",
  "portal.update",
  "webhook.send",
];

const TASK_NAMES = [
  "triage new issues",
  "summarise the folder",
  "write the daily report",
  "publish the changelog",
  "refresh the dashboard",
  "sync the knowledge base",
  "compile the digest",
  "back up the records",
  "answer customer questions",
  "scan for mentions",
  "draft the release notes",
  "export the weekly metrics",
];

/* ---------------------------------------------------------------- builder */

class Builder {
  readonly servers: ServerDecl[] = [];
  readonly resources: ResourceDecl[] = [];
  readonly tools: ToolDecl[] = [];
  readonly tasks: TaskDecl[] = [];
  private readonly serverIds = new Set<string>();
  private readonly resourceIds = new Set<string>();
  private readonly toolNames = new Set<string>();

  constructor(
    private readonly id: string,
    private readonly title: string,
    private readonly note: string,
  ) {}

  private unique(base: string, used: Set<string>): string {
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}.${n}`;
      n += 1;
    }
    used.add(name);
    return name;
  }

  server(base: ServerBase): string {
    const id = this.unique(base.id, this.serverIds);
    this.servers.push({ id, name: base.name, source: "generated" });
    return id;
  }

  resource(decl: { id: string; kind: string } & Omit<ResourceDecl, "id" | "kind">): string {
    const id = this.unique(decl.id, this.resourceIds);
    const out: ResourceDecl = { id, kind: decl.kind };
    if (decl.trust !== undefined) out.trust = decl.trust;
    if (decl.sensitivity !== undefined) out.sensitivity = decl.sensitivity;
    if (decl.visibility !== undefined) out.visibility = decl.visibility;
    if (decl.scope !== undefined) out.scope = decl.scope;
    this.resources.push(out);
    return id;
  }

  tool(t: { name: string; server: string; reads?: string[]; writes?: string[] }): string {
    const name = this.unique(t.name, this.toolNames);
    this.tools.push({
      name,
      server: t.server,
      reads: t.reads ?? [],
      writes: t.writes ?? [],
      labelSource: "declared",
      labelConf: 1,
    });
    return name;
  }

  task(name: string, uses: string[]): void {
    this.tasks.push({ id: `task-${this.tasks.length + 1}`, name, uses });
  }

  build(): ScanConfig {
    return {
      id: this.id,
      title: this.title,
      note: this.note,
      servers: this.servers,
      resources: this.resources,
      tools: this.tools,
      tasks: this.tasks,
    };
  }
}

/* --------------------------------------------------------------- helpers */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function countUses(tasks: TaskDecl[], tool: string): number {
  return tasks.filter((t) => t.uses.includes(tool)).length;
}

/** True when some tool reads a private resource AND some tool writes a public sink. */
export function hasLinkHalfs(cfg: ScanConfig): { readsPrivate: boolean; writesPublic: boolean } {
  const privates = new Set(cfg.resources.filter((r) => r.sensitivity === "private").map((r) => r.id));
  const publics = new Set(cfg.resources.filter((r) => r.visibility === "public").map((r) => r.id));
  return {
    readsPrivate: cfg.tools.some((t) => t.reads.some((r) => privates.has(r))),
    writesPublic: cfg.tools.some((t) => t.writes.some((w) => publics.has(w))),
  };
}

/** The route a leak case was built around, when the config has exactly one. */
export function plantedRoute(cfg: ScanConfig): PlantedRoute | undefined {
  const privates = cfg.resources.filter((r) => r.sensitivity === "private");
  const publics = cfg.resources.filter((r) => r.visibility === "public");
  if (privates.length !== 1 || publics.length !== 1) return undefined;
  const privateResource = privates[0];
  const publicResource = publics[0];
  if (!privateResource || !publicResource) return undefined;
  const readers = cfg.tools.filter((t) => t.reads.includes(privateResource.id));
  const writers = cfg.tools.filter((t) => t.writes.includes(publicResource.id));
  if (readers.length !== 1 || writers.length !== 1) return undefined;
  const reader = readers[0];
  const writer = writers[0];
  if (!reader || !writer) return undefined;
  return { privateResource, publicResource, reader: reader.name, writer: writer.name };
}

/* ----------------------------------------------------------- case kinds */

interface RouteSpec {
  kind: "leak" | "laundering" | "tie";
  ordinal: number;
  expectedSide: "read" | "write";
  /** tie cases only: the two sides' task costs are equal. */
  equalCosts: boolean;
}

function buildRouteCase(rng: Rng, spec: RouteSpec): Case {
  const { kind, ordinal, expectedSide, equalCosts } = spec;
  const id = `gen-${kind}-${pad(ordinal + 1)}`;
  const b = new Builder(
    id,
    `Generated ${kind} case ${pad(ordinal + 1)}`,
    `Generated by packages/eval (mulberry32 seed). Ground truth by construction.`,
  );

  const intakeServer = b.server(rng.pick(INTAKE_SERVERS));
  const privateServer = b.server(rng.pick(PRIVATE_SERVERS));
  const publishServer = b.server(rng.pick(PUBLISH_SERVERS));

  const untrusted = b.resource({
    id: "intake-item",
    kind: rng.pick(UNTRUSTED_KINDS),
    trust: "untrusted",
    scope: `generated://${id}/intake`,
  });
  const privateRes = b.resource({
    id: "private-store",
    kind: rng.pick(PRIVATE_KINDS),
    sensitivity: "private",
    scope: `generated://${id}/private`,
  });
  const publicRes = b.resource({
    id: "public-sink",
    kind: rng.pick(PUBLIC_KINDS),
    visibility: "public",
    scope: `generated://${id}/public`,
  });

  const sharedInjection = rng.bool(0.25);
  const reader = b.tool({
    name: rng.pick(READ_TOOL_NAMES),
    server: privateServer,
    reads: sharedInjection ? [privateRes, untrusted] : [privateRes],
  });
  const writer = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: publishServer, writes: [publicRes] });
  const injector = sharedInjection
    ? undefined
    : b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });

  // Intermediate store: the laundering route writes it, a second tool reads
  // it, and the route reaches the sink only after a second context hop.
  let storeWriter: string | undefined;
  let storeReader: string | undefined;
  if (kind === "laundering") {
    const storeServer = b.server(rng.pick(INTERNAL_SERVERS));
    const store = b.resource({
      id: "staging-store",
      kind: rng.pick(INTERNAL_KINDS),
      sensitivity: "internal",
      visibility: "private",
      scope: `generated://${id}/store`,
    });
    storeWriter = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: privateServer, writes: [store] });
    storeReader = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: storeServer, reads: [store] });
  }

  // Decoys that cannot join any private -> public route: a second intake
  // nobody links to the private store, a dead-end writer that nobody reads,
  // and a read-only tool whose input nobody writes.
  const decoyTools: string[] = [];
  if (!sharedInjection && rng.bool(0.4)) {
    const u2 = b.resource({
      id: "second-intake",
      kind: rng.pick(UNTRUSTED_KINDS),
      trust: "untrusted",
      scope: `generated://${id}/intake-2`,
    });
    decoyTools.push(b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [u2] }));
  }
  if (rng.bool(0.4)) {
    const md = b.resource({
      id: "dead-notes",
      kind: rng.pick(INTERNAL_KINDS),
      sensitivity: "internal",
      visibility: "private",
      scope: `generated://${id}/notes`,
    });
    decoyTools.push(b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: privateServer, writes: [md] }));
  }
  if (rng.bool(0.4)) {
    const r2 = b.resource({
      id: "unwritten-policy",
      kind: rng.pick(INTERNAL_KINDS),
      sensitivity: "internal",
      visibility: "private",
      scope: `generated://${id}/policy`,
    });
    decoyTools.push(b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [r2] }));
  }

  // Task costs. The expected side is fixed first; the declared tasks then
  // realise exactly those counts. Capacity is 1 + cost, so the cheaper side
  // is also the cheaper cut, and equal costs hand the tie to the write side.
  let readerPlan: number;
  let writerPlan: number;
  if (expectedSide === "read") {
    readerPlan = rng.int(0, 2);
    writerPlan = readerPlan + 1 + rng.int(0, 1);
  } else if (equalCosts) {
    readerPlan = rng.int(0, 3);
    writerPlan = readerPlan;
  } else {
    writerPlan = rng.int(0, 2);
    readerPlan = writerPlan + 1 + rng.int(0, 1);
  }

  const taskNames = rng.shuffle(TASK_NAMES);
  const nextName = (): string => {
    const name = taskNames[b.tasks.length % taskNames.length];
    if (name === undefined) throw new Error("task name pool exhausted");
    return name;
  };
  for (let i = 0; i < readerPlan; i += 1) b.task(nextName(), [reader]);
  for (let i = 0; i < writerPlan; i += 1) b.task(nextName(), [writer]);
  const extraChoices = [
    ...(injector === undefined ? [] : [injector]),
    ...(storeWriter === undefined ? [] : [storeWriter]),
    ...(storeReader === undefined ? [] : [storeReader]),
    ...decoyTools,
  ];
  const extras = extraChoices.length > 0 ? rng.int(1, 2) : 0;
  for (let i = 0; i < extras; i += 1) b.task(nextName(), [rng.pick(extraChoices)]);

  const readerCost = countUses(b.tasks, reader);
  const writerCost = countUses(b.tasks, writer);

  // Sanity: the declared tasks must realise the planned costs, and the plan
  // must match the side we claim. A broken plan is a generator bug; fail loud.
  if (readerCost !== readerPlan || writerCost !== writerPlan) {
    throw new Error(`${id}: planned costs ${readerPlan}/${writerPlan} but tasks give ${readerCost}/${writerCost}`);
  }
  const expected = readerCost < writerCost ? reader : writer;
  if (expectedSide === "read" && expected !== reader) throw new Error(`${id}: expected read side but ${expected}`);
  if (expectedSide === "write" && expected !== writer) throw new Error(`${id}: expected write side but ${expected}`);

  const revoked = [expected];
  const config = b.build();
  return {
    id,
    kind,
    config,
    truth: {
      hasRoute: true,
      expectedGrants: revoked,
      expectedTasksKept: config.tasks?.filter((t) => !t.uses.some((u) => revoked.includes(u))).length ?? 0,
      expectedTasksTotal: config.tasks?.length ?? 0,
    },
  };
}

function buildCleanCase(rng: Rng, ordinal: number): Case {
  const id = `gen-clean-${pad(ordinal + 1)}`;
  const b = new Builder(
    id,
    `Generated clean case ${pad(ordinal + 1)}`,
    `Generated by packages/eval (mulberry32 seed). Ground truth by construction: one half of the private->public link is missing.`,
  );

  const intakeServer = b.server(rng.pick(INTAKE_SERVERS));
  const privateServer = b.server(rng.pick(PRIVATE_SERVERS));
  const publishServer = b.server(rng.pick(PUBLISH_SERVERS));

  const untrusted = b.resource({
    id: "intake-item",
    kind: rng.pick(UNTRUSTED_KINDS),
    trust: "untrusted",
    scope: `generated://${id}/intake`,
  });
  const internal = b.resource({
    id: "internal-store",
    kind: rng.pick(INTERNAL_KINDS),
    sensitivity: "internal",
    visibility: "private",
    scope: `generated://${id}/internal`,
  });
  const privateRes = b.resource({
    id: "private-store",
    kind: rng.pick(PRIVATE_KINDS),
    sensitivity: "private",
    scope: `generated://${id}/private`,
  });
  const publicRes = b.resource({
    id: "public-sink",
    kind: rng.pick(PUBLIC_KINDS),
    visibility: "public",
    scope: `generated://${id}/public`,
  });

  const tools: string[] = [];
  switch (ordinal % 8) {
    case 0: {
      // No writers at all: private and public are both read into context.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });
      const a = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes, publicRes, internal] });
      tools.push(u, a);
      break;
    }
    case 1: {
      // Writers exist, but only into an internal store nobody reads.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });
      const a = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes] });
      const d = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: privateServer, writes: [internal] });
      tools.push(u, a, d);
      break;
    }
    case 2: {
      // Publish-only: the public sink is written, but nothing reads a private store.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted, internal] });
      const w = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: publishServer, writes: [publicRes] });
      tools.push(u, w);
      break;
    }
    case 3: {
      // The private store is written (a journal), never read.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });
      const j = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: privateServer, writes: [privateRes, internal] });
      const w = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: publishServer, writes: [publicRes] });
      tools.push(u, j, w);
      break;
    }
    case 4: {
      // Readers on both sides, no writer into the public sink.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted, internal] });
      const a = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes] });
      const r = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: publishServer, reads: [publicRes] });
      tools.push(u, a, r);
      break;
    }
    case 5: {
      // Two public sinks, both read-only; the writer only feeds internal.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });
      const a = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes] });
      const r = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: publishServer, reads: [publicRes] });
      const d = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: privateServer, writes: [internal] });
      tools.push(u, a, r, d);
      break;
    }
    case 6: {
      // Two private stores, both read; the public sink is only read.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted] });
      const a1 = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes] });
      const a2 = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [internal] });
      const r = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: publishServer, reads: [publicRes] });
      tools.push(u, a1, a2, r);
      break;
    }
    default: {
      // Red herrings: untrusted intakes, a private reader, a written internal
      // store — but no writer of any public sink.
      const u = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: intakeServer, reads: [untrusted, internal] });
      const w = b.tool({ name: rng.pick(WRITE_TOOL_NAMES), server: intakeServer, writes: [internal] });
      const a = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: privateServer, reads: [privateRes] });
      const r = b.tool({ name: rng.pick(READ_TOOL_NAMES), server: publishServer, reads: [publicRes] });
      tools.push(u, w, a, r);
      break;
    }
  }

  const taskNames = rng.shuffle(TASK_NAMES);
  const taskCount = rng.int(2, 5);
  for (let i = 0; i < taskCount; i += 1) {
    const name = taskNames[i % taskNames.length];
    if (name === undefined) throw new Error("task name pool exhausted");
    const uses = i % 2 === 0 ? [rng.pick(tools)] : [rng.pick(tools), rng.pick(tools)];
    b.task(name, [...new Set(uses)]);
  }

  const config = b.build();
  return {
    id,
    kind: "clean",
    config,
    truth: {
      hasRoute: false,
      expectedGrants: [],
      expectedTasksKept: config.tasks?.length ?? 0,
      expectedTasksTotal: config.tasks?.length ?? 0,
    },
  };
}

/* ------------------------------------------------------------------- mix */

export interface Mix {
  leak: number;
  laundering: number;
  clean: number;
  tie: number;
}

export function caseMix(n: number): Mix {
  const leak = Math.round(n * 0.4);
  const laundering = Math.round(n * 0.2);
  const clean = Math.round(n * 0.2);
  return { leak, laundering, clean, tie: Math.max(0, n - leak - laundering - clean) };
}

/**
 * The generator contract: seed in, cases out. Same seed -> identical cases,
 * byte for byte. `n` scales the 40% leak / 20% laundering / 20% clean /
 * remainder tie mix; the default is the 16/8/8/8 set the results were
 * generated from.
 */
export function makeCases(seed: number = DEFAULT_SEED, n: number = DEFAULT_N): Case[] {
  if (n < 0) throw new Error("makeCases: n must be >= 0");
  const rng = makeRng(seed);
  const mix = caseMix(n);
  const cases: Case[] = [];

  for (let i = 0; i < mix.leak; i += 1) {
    // Half the leak cases expect the read side, half the write side; the
    // costs are strict, so only the policy (cheaper side) decides.
    const expectedSide = i < mix.leak / 2 ? "read" : "write";
    cases.push(buildRouteCase(rng, { kind: "leak", ordinal: i, expectedSide, equalCosts: false }));
  }
  for (let i = 0; i < mix.laundering; i += 1) {
    const expectedSide = i < mix.laundering / 2 ? "read" : "write";
    cases.push(buildRouteCase(rng, { kind: "laundering", ordinal: i, expectedSide, equalCosts: false }));
  }
  for (let i = 0; i < mix.clean; i += 1) {
    cases.push(buildCleanCase(rng, i));
  }
  for (let i = 0; i < mix.tie; i += 1) {
    // Half expect the read side. Of the write half, alternate equal costs
    // (the documented tie-break to the write side) and a strictly cheaper
    // write side. "tie" means both a read-side and a write-side cut exist.
    const half = Math.ceil(mix.tie / 2);
    const expectedSide = i < half ? "read" : "write";
    const writeIndex = i - half;
    const equalCosts = expectedSide === "write" && writeIndex % 2 === 1;
    cases.push(buildRouteCase(rng, { kind: "tie", ordinal: i, expectedSide, equalCosts }));
  }

  for (const c of cases) {
    const problems = validateScanConfig(c.config);
    if (problems.length > 0) {
      throw new Error(`${c.id}: generator produced an invalid config:\n- ${problems.join("\n- ")}`);
    }
  }
  return cases;
}
