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
  LEAK_COUNT,
  LEAK_PATH,
  LEAK_PATH_FAST,
  MIN_CUT,
  VERIFY_FIX,
  bold,
  cutFromMaxFlow,
  green,
  ingest,
  parseLeakPaths,
  red,
  scanGraphName,
  scanStatus,
  type FlowEdge,
  type LeakPath,
  type MaxFlowRow,
} from "@lethalpath/core";
import type { ScanConfig } from "@lethalpath/schema";
import { labelConfig } from "@lethalpath/labeler";

const USAGE = `lethalpath <scan|fix> [config.json] [options]

  scan [config.json]   build the graph and name every leak route
  fix  [config.json]   revoke the cheapest grant that closes them all

  config.json defaults to data/fixtures/fs-git.json
  --mcp <mcp.json>     label a real MCP config first (packages/labeler), then scan it
  --json               machine-readable output
  --host <host>        FalkorDB host (default localhost)
  --port <port>        FalkorDB port (default 6379)`;

interface CliArgs {
  verb: string;
  config: string;
  mcp?: string;
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
    else if (token === "--mcp") {
      const value = rest[i + 1];
      if (value !== undefined) {
        args.mcp = value;
        i += 1;
      }
    } else if (token === "--host") {
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

interface LoadedScan {
  cfg: ScanConfig;
  source: "config" | "mcp";
  unlabelled: string[];
  /** What the labeler's secret pass replaced; zero when no labeler ran. */
  redacted: { values: number; names: number };
}

/**
 * `--mcp` runs the labeler first: the rules table turns a real MCP config into
 * the scan graph, secrets never leave the machine, and tools no rule
 * recognises come back named instead of silently treated as harmless. An
 * invalid labelling throws here — it can never reach a Cypher string.
 */
function loadScan(args: CliArgs): LoadedScan {
  if (args.mcp === undefined) {
    return {
      cfg: loadConfig(args.config),
      source: "config",
      unlabelled: [],
      redacted: { values: 0, names: 0 },
    };
  }
  const raw = JSON.parse(readFileSync(resolve(args.mcp), "utf8")) as unknown;
  const { config, unlabelled, redacted } = labelConfig(raw, {});
  return { cfg: config, source: "mcp", unlabelled, redacted };
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
  /** All resources under a display kind; more than one means citations cannot name a scope. */
  byKind: Map<string, ResourceInfo[]>;
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
  const byKind = new Map<string, ResourceInfo[]>();
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
    const list = byKind.get(info.kind);
    if (list === undefined) byKind.set(info.kind, [info]);
    else list.push(info);
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
  const { cfg, source, unlabelled, redacted } = loadScan(args);
  const db = await GraphDB.open(scanGraphName(cfg.id), args.host, args.port);
  try {
    const built = await ingest(db, cfg);
    const status = await scanStatus(db);
    if (!status.ready) throw new Error("graph is not ready; ingest did not finish");

    let paths: LeakPath[];
    let pathOrder: "shortest" | "arbitrary" | "unlisted" = "shortest";
    try {
      paths = parseLeakPaths((await db.read(LEAK_PATH)).rows);
    } catch {
      // The ordered query materialises every walk; on graphs where tools
      // chain through the context hub that explodes. Without ORDER BY the
      // engine can stop at the display limit — fall back, and say so.
      try {
        paths = parseLeakPaths((await db.read(LEAK_PATH_FAST)).rows);
        pathOrder = "arbitrary";
      } catch {
        paths = [];
        pathOrder = "unlisted";
      }
    }
    const routes = Number((await db.read(LEAK_COUNT)).rows[0]?.["routes"] ?? 0);
    const resources = await resourceIndex(db);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            verb: "scan",
            config: cfg.id,
            title: cfg.title,
            source,
            unlabelled,
            graph: built.graph,
            nodes: built.nodes,
            edges: built.edges,
            ready: status.ready,
            routes,
            pathsShown: paths.length,
            pathOrder,
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
    out.push("engine    leak two anchored segments through the tainted context · fix CALL algo.maxFlow + residual min-cut");
    if (source === "mcp") {
      const shown = unlabelled.slice(0, 5).join(", ");
      const tail = unlabelled.length > 5 ? `, +${unlabelled.length - 5} more` : "";
      out.push(
        `labelled  ${cfg.tools.length} tool${cfg.tools.length === 1 ? "" : "s"} by rule · ` +
          (unlabelled.length === 0 ? "0 unlabelled" : `${unlabelled.length} unlabelled (${shown}${tail})`),
      );
      if (redacted.values + redacted.names > 0) {
        out.push(
          `redacted  ${redacted.values} value${redacted.values === 1 ? "" : "s"}, ` +
            `${redacted.names} token-shaped name${redacted.names === 1 ? "" : "s"} — stripped before the graph`,
        );
      }
    }
    out.push("");

    if (routes === 0) {
      out.push(green("0 routes from private data to a public sink."));
      out.push("");
      out.push(green("nothing to revoke — that is the answer, not an error."));
      out.push(
        `the graph holds ${resources.privateCount} private store${resources.privateCount === 1 ? "" : "s"} ` +
          `and ${resources.sinkCount} public sink${resources.sinkCount === 1 ? "" : "s"}; none are connected to each other.`,
      );
    } else {
      const headline =
        `${red(bold(routes))} route${routes === 1 ? "" : "s"} found — ` +
        "every one of them is a permission you granted.";
      // When the list is a sample, the count must lead — the punchline cannot
      // sit under three screens of near-identical routes. A complete listing
      // keeps the conclusion at the end.
      const truncated = routes > paths.length;
      if (truncated) {
        out.push(headline);
        out.push("");
      }
      out.push(red("LEAK PATHS"));
      paths.forEach((path, i) => {
        out.push(`  ${i + 1}  ${path.hops} hops  ${path.chain.join(" → ")}`);
        out.push(`     injection  ${path.injection.join(" → ")}`);
        const cite = (label: string, kind: string | undefined): void => {
          if (kind === undefined) return;
          const list = resources.byKind.get(kind) ?? [];
          if (list.length > 1) {
            out.push(`     ${label}${kind} · scope omitted — ${list.length} resources share this kind`);
          } else if (list[0]?.scope !== undefined) {
            out.push(`     ${label}${kind} · ${list[0].scope}`);
          }
        };
        cite("in         ", path.chain[0]);
        cite("out        ", path.chain[path.chain.length - 1]);
        out.push("");
      });
      if (!truncated) out.push(headline);
      if (routes > paths.length && pathOrder === "shortest") {
        out.push(`  note   showing the ${paths.length} shortest by hops; the graph has ${routes} in total`);
      }
      if (pathOrder === "arbitrary") {
        out.push(
          `  note   route enumeration exceeded the server budget on this graph; showing ${paths.length} of ${routes} routes, order unspecified — the count is exact, and fix is unaffected`,
        );
      }
      if (pathOrder === "unlisted") {
        out.push(
          `  note   route enumeration exceeded the server budget; routes are not listed — the count is exact, and fix is unaffected`,
        );
      }
      out.push("  next  lethalpath fix");
    }
    console.log(out.join("\n"));
    return 0;
  } finally {
    await db.close();
  }
}

async function fix(args: CliArgs): Promise<number> {
  const { cfg } = loadScan(args);
  const db = await GraphDB.open(scanGraphName(cfg.id), args.host, args.port);
  try {
    const built = await ingest(db, cfg);
    const routes = Number((await db.read(LEAK_COUNT)).rows[0]?.["routes"] ?? 0);
    const sourceIds = await idList(
      db,
      `MATCH (p:Resource {sensitivity:'private'})
       WHERE p.visibility IS NULL OR p.visibility <> 'public'
       RETURN id(p) AS id`,
    );
    const targetIds = await idList(
      db,
      `MATCH (s:Resource {visibility:'public'})
       WHERE s.sensitivity IS NULL OR s.sensitivity <> 'private'
       RETURN id(s) AS id`,
    );

    const absten = (line: string, safe = false): number => {
      console.log([BANNER, "", "FIX", "", safe ? green(line) : line].join("\n"));
      return 0;
    };
    if (routes === 0) return absten("nothing to revoke — no route was found to close.", true);
    if (sourceIds.length === 0) {
      return absten(
        "routes exist, but every private resource is also marked public — the sides overlap, so no revocable cut exists from these labels.",
      );
    }
    if (targetIds.length === 0) {
      return absten(
        "routes exist, but every public sink is also marked private — the sides overlap, so no revocable cut exists from these labels.",
      );
    }

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
            closes: routes,
            verifiedRemaining: remaining,
            tasks: { total: tasks.length, kept, lost: lost.map((task) => task.id) },
          },
          null,
          2,
        ),
      );
      return closed ? 0 : 1;
    }

    // The receipt is what a recording points the camera at, so a long list
    // wraps one item per line, aligned under its label; a single item keeps
    // the one-line form. Every fact and every number stays.
    const INDENT = " ".repeat(11);
    const out: string[] = [BANNER, ""];
    out.push("FIX  ·  CALL algo.maxFlow on FalkorDB");
    out.push("");
    out.push(`max-flow   ${bold(cut.maxFlow)}`);
    if (cut.edges.length > 1) {
      out.push(`cut        ${String(cut.side)} side`);
      for (const edge of cut.edges) out.push(`${INDENT}${edgeLabel(edge)}`);
    } else {
      out.push(`cut        ${String(cut.side)} side · ${cut.edges.map(edgeLabel).join(", ")}`);
    }
    const first = cut.grants[0];
    if (cut.grants.length > 1 && first !== undefined) {
      out.push(`revoke     ${red(first)}`);
      for (const grant of cut.grants.slice(1)) out.push(`${INDENT}${red(grant)}`);
    } else {
      out.push(`revoke     ${cut.grants.map(red).join(", ")}`);
    }
    if (closed) {
      if (cut.grants.length > 1) {
        out.push(`verified   ${green(`${bold(remaining)} of ${routes} routes remain`)}`);
        out.push(`${INDENT}${green("leak query re-run without the revoked grants")}`);
      } else {
        out.push(
          `verified   ${green(
            `${bold(remaining)} of ${routes} routes remain (leak query re-run without ${cut.grants.join(", ")})`,
          )}`,
        );
      }
    } else {
      out.push(
        `verified   ${red(`${bold(remaining)} of ${routes} routes STILL OPEN — cut did not close everything`)}`,
      );
    }
    if (tasks.length > 0) {
      out.push(`tasks      ${bold(kept)} of ${bold(tasks.length)} keep working`);
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
  const argv = process.argv.slice(2);
  const [verb = ""] = argv;
  // Help is asked for anywhere: `scan --help` and `fix -h` print the same
  // usage the bare invocation does, and answer 0. Asking for help is not an
  // error, at any position.
  if (verb === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (args.verb === "scan") return scan(args);
  if (args.verb === "fix") return fix(args);
  console.log(USAGE);
  return verb === "" ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`lethalpath: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
