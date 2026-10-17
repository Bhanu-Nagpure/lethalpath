/**
 * FalkorDB access for LethalPath.
 *
 * Two constraints, both verified by execution on falkordb/falkordb:6.0.2
 * rather than taken from the docs:
 *
 *   1. Parameters bind through the `CYPHER k=v …` query PREFIX. The trailing
 *      `PARAMS n k v` form reports `$x` as "not found". We inject the prefix
 *      ourselves so a caller can never hit the broken form by accident.
 *
 *   2. Every read goes through GRAPH.RO_QUERY. The server rejects writes on it
 *      outright ("graph.RO_QUERY is to be executed only on read-only queries"),
 *      which is the property the guard depends on. We add a write-keyword check
 *      and a LIMIT cap in front of that, so a hostile parameter is refused
 *      before it is dispatched.
 *
 * The model never receives a handle to this module. Cypher decides; the model
 * only ever sees its results.
 */

import { FalkorDB as Client, type Graph } from "falkordb";

const WRITE = /\b(create|merge|delete|remove|set|drop|detach|foreach|load\s+csv)\b/i;
const LIMIT_CAP = 100;
const READ_TIMEOUT_MS = 3000;

/**
 * A guard has to give up. If the server does not answer inside the budget we
 * abandon the read and say so; the connection is closed by the caller.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`read-only guard: query abandoned after ${ms} ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  stats: string[];
}

export class GraphDB {
  private constructor(
    private readonly graph: Graph,
    private readonly client: Client,
  ) {}

  static async open(name: string, host = "localhost", port = 6379): Promise<GraphDB> {
    const client = await Client.connect({ socket: { host, port } });
    return new GraphDB(client.selectGraph(name), client);
  }

  /** Close the underlying connection. Tests must call this or the process hangs. */
  async close(): Promise<void> {
    await this.client.close();
  }

  /** Read-only. Refuses write keywords before dispatch; the server enforces it too. */
  async read(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    const flat = JSON.stringify(params);
    if (WRITE.test(flat)) {
      throw new Error("read-only guard: write keyword in parameter, refused before dispatch");
    }
    if (WRITE.test(cypher)) {
      throw new Error("read-only guard: write keyword in query, refused before dispatch");
    }
    const capped = this.capLimit(cypher);
    const prefixed = this.prefix(capped, params);
    const res = await withTimeout(this.graph.roQuery(prefixed), READ_TIMEOUT_MS);
    return this.shape(res);
  }

  /** Writes. Used only by ingest and by the audit append, never by the guard. */
  async write(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    const res = await this.graph.query(this.prefix(cypher, params));
    return this.shape(res);
  }

  private shape(res: { data?: unknown; metadata?: string[] }): QueryResult {
    const data = res.data;
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    return { rows, stats: res.metadata ?? [] };
  }

  /**
   * `CYPHER k=v` prefix. FalkorDB's map literal requires unquoted keys, so we
   * emit Cypher literals directly rather than JSON.
   */
  private prefix(cypher: string, params: Record<string, unknown>): string {
    const keys = Object.keys(params);
    if (keys.length === 0) return cypher;
    const head = keys.map((k) => `${k}=${literal(params[k])}`).join(" ");
    return `CYPHER ${head} ${cypher}`;
  }

  /** A LIMIT above the cap is clamped. No LIMIT at all gets one appended. */
  private capLimit(cypher: string): string {
    if (/\blimit\s+\d+/i.test(cypher)) {
      return cypher.replace(/\blimit\s+(\d+)/i, (_m, n) =>
        `LIMIT ${Math.min(Number(n), LIMIT_CAP)}`,
      );
    }
    return `${cypher.replace(/\s+$/, "")} LIMIT ${LIMIT_CAP}`;
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (Array.isArray(v)) return `[${v.map(literal).join(",")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{${entries.map(([k, val]) => `${k}:${literal(val)}`).join(",")}}`;
  }
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
