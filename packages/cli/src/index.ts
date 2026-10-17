#!/usr/bin/env node
/**
 * lethalpath — the verbs a person actually types.
 *
 *   scan  read a config, build the graph in FalkorDB, and name every route an
 *         attacker could take: untrusted input → private data → public sink.
 *   fix   run CALL algo.maxFlow on that graph, derive the residual min-cut,
 *         and print the cheapest grant to revoke plus what workflows survive.
 *
 * Exit codes: 0 = answered (including "no route found" — that is an answer),
 * 1 = refused or failed. Reads go through the guarded client; nothing here
 * ever writes with a read handle.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BANNER,
  GraphDB,
  LEAK_PATH,
  MIN_CUT,
  VERIFY_FIX,
  cutFromMaxFlow,
  ingest,
  parseLeakPaths,
  scanGraphName,
  scanStatus,
  type FlowEdge,
  type MaxFlowRow,
} from "@lethalpath/core";
import type { ScanConfig } from "@lethalpath/schema";

const USAGE = `lethalpath <scan|fix> [config.json] [options]

  scan [config.json]   build the graph and name every leak route
  fix  [config.json]   revoke the cheapest grant that closes them all

  config.json defaults to data/fixtures/fs-git.json
  --json               machine-readable output
  --host <host>        FalkorDB host (default localhost)
  --port <port>        FalkorDB port (default 6379)`;

interface CliArgs {
  verb: string;
  config: string;
  json: boolean;
  host: string;
  port: number;
}

function parseArgs(argv: string[]): CliArgs {
  const [verb = "", ...rest] = argv;
  const args: CliArgs = {
    verb,
    config: "data/fixtures/fs-git.json",
    json: false,
    host: "localhost",
    port: 6379,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json") args.json = true;
    else if (token === "--host") {
      const value = rest[i + 1];
      if (value !== undefined) {
        args.host = value;
        i += 1;
      }
    } else if (token === "--port") {
      const value = rest[i + 1];
      if (value !== undefined) {
        args.port = Number(value);
        i += 1;
      }
    } else if (token !== undefined && !token.startsWith("--")) args.config = token;
    else throw new Error(`unknown option '${String(token)}'`);
  }
  return args;
}

function loadConfig(path: string): ScanConfig {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as ScanConfig;
}

function opt(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

interface ResourceInfo {
  id: string;
  kind: string;
  scope?: string;
  trust?: string;
  sensitivity?: string;
  visibility?: string;
}

interface ResourceIndex {
  byKind: Map<string, ResourceInfo>;
  privateCount: number;
  sinkCount: number;
}

/** Citations resolve to kind + scope, never to internal node ids. */
async function resourceIndex(db: GraphDB): Promise<ResourceIndex> {
  const res = await db.read(`
    MATCH (r:Resource)
    RETURN r.id AS id, r.kind AS kind, r.scope AS scope, r.trust AS trust,
           r.sensitivity AS sensitivity, r.visibility AS visibility
  `);
  const byKind = new Map<string, ResourceInfo>();
  let privateCount = 0;
  let sinkCount = 0;
  for (const row of res.rows) {
    const info: ResourceInfo = {
      id: String(row["id"]),
      kind: String(row["kind"]),
      scope: opt(row["scope"]),
      trust: opt(row["trust"]),
      sensitivity: opt(row["sensitivity"]),
      visibility: opt(row["visibility"]),
    };
    if (!byKind.has(info.kind)) byKind.set(info.kind, info);
    if (info.sensitivity === "private") privateCount += 1;
    if (info.visibility === "public") sinkCount += 1;
  }
  return { byKind, privateCount, sinkCount };
}

async function idList(db: GraphDB, cypher: string): Promise<number[]> {
  return (await db.read(cypher)).rows.map((row) => Number(row["id"]));
}

function rowToEdge(row: Record<string, unknown>): FlowEdge {
  return {
    id: Number(row["id"]),
    from: Number(row["fromId"]),
    to: Number(row["toId"]),
    capacity: Number(row["capacity"]),
    grant: row["grant"] == null ? null : String(row["grant"]),
    revocable: row["revocable"] === true,
    tasksLost: Number(row["taskCost"] ?? 0),
    fromLabel: opt(row["fromLabel"]),
    toLabel: opt(row["toLabel"]),
  };
}

function edgeLabel(edge: FlowEdge): string {
  const from = edge.fromLabel ?? `#${edge.from}`;
  const to = edge.toLabel ?? `#${edge.to}`;
  return `${from} → ${to}`;
}

async function scan(args: CliArgs): Promise<number> {
  const cfg = loadConfig(args.config);
  const db = await GraphDB.open(scanGraphName(cfg.id), args.host, args.port);
  try {
    const built = await ingest(db, cfg);
    const status = await scanStatus(db);
    if (!status.ready) throw new Error("graph is not ready; ingest did not finish");

    const paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
    const resources = await resourceIndex(db);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            verb: "scan",
            config: cfg.id,
            title: cfg.title,
            graph: built.graph,
            nodes: built.nodes,
            edges: built.edges,
            ready: status.ready,
            paths,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const out: string[] = [BANNER, ""];
    out.push(`config    ${cfg.id} · ${cfg.title}`);
    out.push(`graph     ${built.graph} · ${built.nodes} nodes · ${built.edges} edges · ready`);
    out.push("guard     GRAPH.RO_QUERY · LIMIT 100 · 3 s timeout · write keywords refused");
    out.push("engine    leak MATCH -[:FLOWS*2..10]->  ·  fix CALL algo.maxFlow + residual min-cut");
    out.push("");

    if (paths.length === 0) {
      out.push("0 routes from private data to a public sink.");
      out.push("");
      out.push("nothing to revoke — that is the answer, not an error.");
      out.push(
        `the graph holds ${resources.privateCount} private store${resources.privateCount === 1 ? "" : "s"} ` +
          `and ${resources.sinkCount} public sink${resources.sinkCount === 1 ? "" : "s"}; none are connected to each other.`,
      );
    } else {
      out.push("LEAK PATHS");
      paths.forEach((path, i) => {
        out.push(`  ${i + 1}  ${path.hops} hops  ${path.chain.join(" → ")}`);
        out.push(`     injection  ${path.injection.join(" → ")}`);
        const tail = path.chain[0];
        const head = path.chain[path.chain.length - 1];
        const from = tail === undefined ? undefined : resources.byKind.get(tail);
        const to = head === undefined ? undefined : resources.byKind.get(head);
        if (from?.scope) out.push(`     in         ${from.kind} · ${from.scope}`);
        if (to?.scope) out.push(`     out        ${to.kind} · ${to.scope}`);
        out.push("");
      });
      out.push(
        `${paths.length} route${paths.length === 1 ? "" : "s"} found — every one of them is a permission you granted.`,
      );
      out.push("  next  lethalpath fix");
    }
    console.log(out.join("\n"));
    return 0;
  } finally {
    await db.close();
  }
}

async function fix(args: CliArgs): Promise<number> {
  const cfg = loadConfig(args.config);
  const db = await GraphDB.open(scanGraphName(cfg.id), args.host, args.port);
  try {
    const built = await ingest(db, cfg);
    const paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
    const sourceIds = await idList(db, `MATCH (p:Resource {sensitivity:'private'}) RETURN id(p) AS id`);
    const targetIds = await idList(db, `MATCH (s:Resource {visibility:'public'}) RETURN id(s) AS id`);

    const absten = (line: string): number => {
      console.log([BANNER, "", "FIX", "", line].join("\n"));
      return 0;
    };
    if (paths.length === 0) return absten("nothing to revoke — no route was found to close.");
    if (sourceIds.length === 0) return absten("nothing to protect — no private resource is declared.");
    if (targetIds.length === 0) return absten("nothing can leave — no public sink is declared.");

    const edges: FlowEdge[] = (
      await db.read(`
        MATCH (a)-[e:FLOWS]->(b)
        RETURN id(e) AS id, id(a) AS fromId, id(b) AS toId,
               coalesce(a.kind, a.name, a.id) AS fromLabel,
               coalesce(b.kind, b.name, b.id) AS toLabel,
               e.capacity AS capacity, e.grant AS grant,
               e.revocable AS revocable, e.taskCost AS taskCost
      `)
    ).rows.map(rowToEdge);

    const row = (await db.read(MIN_CUT)).rows[0] as unknown as MaxFlowRow | undefined;
    if (!row) throw new Error("algo.maxFlow returned no row");
    const cut = cutFromMaxFlow(sourceIds, targetIds, edges, row);

    // The fix proves itself: run the leak query again with the revoked grants
    // excluded. Zero rows is the receipt; anything else is reported loudly.
    const remaining = Number(
      (await db.read(VERIFY_FIX, { revoked: cut.grants })).rows[0]?.["remaining"] ?? -1,
    );
    const closed = remaining === 0;

    const revoked = new Set(cut.grants);
    const tasks = cfg.tasks ?? [];
    const lost = tasks.filter((task) => task.uses.some((tool) => revoked.has(tool)));
    const kept = tasks.length - lost.length;

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            verb: "fix",
            config: cfg.id,
            graph: built.graph,
            maxFlow: cut.maxFlow,
            side: cut.side,
            grants: cut.grants,
            cutEdges: cut.edges.map((edge) => edgeLabel(edge)),
            closes: paths.length,
            verifiedRemaining: remaining,
            tasks: { total: tasks.length, kept, lost: lost.map((task) => task.id) },
          },
          null,
          2,
        ),
      );
      return closed ? 0 : 1;
    }

    const out: string[] = [BANNER, ""];
    out.push("FIX  ·  CALL algo.maxFlow on FalkorDB");
    out.push("");
    out.push(`max-flow   ${cut.maxFlow}`);
    out.push(`cut        ${String(cut.side)} side · ${cut.edges.map(edgeLabel).join(", ")}`);
    out.push(`revoke     ${cut.grants.join(", ")}`);
    out.push(
      closed
        ? `verified   0 of ${paths.length} routes remain (leak query re-run without ${cut.grants.join(", ")})`
        : `verified   ${remaining} of ${paths.length} routes STILL OPEN — cut did not close everything`,
    );
    if (tasks.length > 0) {
      out.push(`tasks      ${kept} of ${tasks.length} keep working`);
      if (lost.length > 0) out.push(`           loses: ${lost.map((task) => task.name).join(", ")}`);
    }
    out.push("");
    out.push("cost = 1 + declared tasks that use the grant; the max-flow value proves");
    out.push("this cut is minimal. The verification re-runs the same query, not a promise.");
    console.log(out.join("\n"));
    return closed ? 0 : 1;
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.verb === "scan") return scan(args);
  if (args.verb === "fix") return fix(args);
  console.log(USAGE);
  if (args.verb === "" || args.verb === "help" || args.verb === "--help") return 0;
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`lethalpath: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
