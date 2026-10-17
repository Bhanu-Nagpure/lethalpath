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
 *      which is the property the guard depends on. In front of that we add
 *      three more: a write-keyword check, a LIMIT cap, and a 3 s deadline.
 *
 * The keyword check and the cap read the query with literals and comments
 * blanked out, so `RETURN 'the set of tools'` is not mistaken for a write and
 * a LIMIT inside a string is not mistaken for a cap. Parameter values are
 * never scanned: they are escaped by `literal()`, and object keys inside a
 * parameter are validated as identifiers — a parameter cannot add query text.
 * Parameter keys are validated because those are concatenated.
 *
 * The model never receives a handle to this module. Cypher decides; the model
 * only ever sees its results.
 */

import { FalkorDB as Client, type Graph } from "falkordb";

const WRITE = /\b(create|merge|delete|remove|set|drop|detach|foreach|load\s+csv)\b/i;
const LIMIT_CAP = 100;
const READ_TIMEOUT_MS = 3000;
const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Same length as the input, with the insides of string literals, `//` comments
 * and `/* *​/` comments replaced by spaces. Regexes that run on this see the
 * query's structure, not its data. Length is preserved so match offsets can be
 * mapped back onto the original string.
 */
function maskLiterals(cypher: string): string {
  let out = "";
  let i = 0;
  const n = cypher.length;
  while (i < n) {
    const ch = cypher[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      out += ch;
      i += 1;
      while (i < n) {
        const c = cypher[i];
        if (c === "\\" && i + 1 < n) {
          out += "  ";
          i += 2;
          continue;
        }
        if (c === ch) {
          out += ch;
          i += 1;
          break;
        }
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && cypher[i + 1] === "/") {
      while (i < n && cypher[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && cypher[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(cypher[i] === "*" && cypher[i + 1] === "/")) {
        out += " ";
        i += 1;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

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

  /**
   * Delete the underlying graph key. Teardown only — `pnpm test` uses it so a
   * run leaves GRAPH.LIST exactly as it found it. No answer path ever calls it.
   */
  async drop(): Promise<void> {
    await this.graph.delete();
  }

  /** Read-only. Refuses write keywords before dispatch; the server enforces it too. */
  async read(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    if (WRITE.test(maskLiterals(cypher))) {
      throw new Error("read-only guard: write keyword in query, refused before dispatch");
    }
    const capped = this.capLimit(cypher);
    const prefixed = this.prefix(capped, params);
    const res = await withTimeout(this.graph.roQuery(prefixed), READ_TIMEOUT_MS);
    return this.shape(res);
  }

  /** Writes. Used only by ingest and by the guard's session log, never to answer a question. */
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
   * emit Cypher literals directly rather than JSON — and the key is the one
   * part that is concatenated raw, so it is validated here.
   */
  private prefix(cypher: string, params: Record<string, unknown>): string {
    const keys = Object.keys(params);
    if (keys.length === 0) return cypher;
    const head = keys
      .map((k) => {
        if (!PARAM_KEY.test(k)) {
          throw new Error(`read-only guard: parameter key '${k}' is not a valid identifier`);
        }
        return `${k}=${literal(params[k])}`;
      })
      .join(" ");
    return `CYPHER ${head} ${cypher}`;
  }

  /**
   * The cap is about the rows that leave here, so it looks at LIMIT clauses
   * AFTER the final RETURN: a limit above the cap is clamped to it, a
   * parameterised limit is the caller's to keep, and a RETURN with no limit
   * after it gets one appended on its own line (so a trailing `//` comment
   * cannot swallow it). A query with no RETURN at all — a bare procedure CALL,
   * say — is left alone, because appending LIMIT there is a syntax error.
   * Matching runs on the masked query, so "limit 2" inside a string is not a
   * limit.
   */
  private capLimit(cypher: string): string {
    const masked = maskLiterals(cypher);
    let lastReturn = -1;
    for (const m of masked.matchAll(/\breturn\b/gi)) lastReturn = m.index ?? -1;
    if (lastReturn === -1) return cypher;
    const limitRe = /\blimit\s+(-?[\d.]+(?:e[+-]?\d+)?|\$[A-Za-z_][A-Za-z0-9_]*)/gi;
    const after = [...masked.matchAll(limitRe)].filter((m) => (m.index ?? 0) > lastReturn);
    const last = after[after.length - 1];
    if (!last) return `${cypher.replace(/\s+$/, "")}\nLIMIT ${LIMIT_CAP}`;
    const value = last[1] ?? "";
    if (value.startsWith("$")) return cypher;
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= LIMIT_CAP) return cypher;
    const start = (last.index ?? 0) + last[0].length - value.length;
    return `${cypher.slice(0, start)}${LIMIT_CAP}${cypher.slice(start + value.length)}`;
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (Array.isArray(v)) return `[${v.map(literal).join(",")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{${entries
      .map(([k, val]) => {
        if (!PARAM_KEY.test(k)) {
          throw new Error(`read-only guard: parameter object key '${k}' is not a valid identifier`);
        }
        return `${k}:${literal(val)}`;
      })
      .join(",")}}`;
  }
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
