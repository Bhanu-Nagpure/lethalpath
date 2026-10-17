/**
 * Reading a pasted `mcp.json` — safely.
 *
 * A real Claude Desktop config names servers and how to launch them; it does
 * not list tools. It CAN also carry `tools` arrays (our own captures add them
 * after tool discovery), and the whole thing may also be one of our own
 * ScanConfigs, which is passed through.
 *
 * Secrets are stripped before anything else happens: every `env` value is
 * replaced, every value whose key looks like a credential is replaced, and
 * every string that looks like a token is replaced — in key position too,
 * because a key is just another string. Nothing in the returned structures
 * ever contains them — `stripSecrets` is exported so callers can strip and
 * then look at the whole thing themselves.
 */

import type { ScanConfig } from "@lethalpath/schema";

import { expandServerTools } from "./rules.js";

/** One server after parsing. No env, no headers, no launch secrets — ever. */
export interface McpServerEntry {
  /** Safe slug for graph ids, derived from the name. */
  id: string;
  /** The name as written in the config. */
  name: string;
  /** Where this declaration came from: 'mcp.json' or 'declared'. */
  source: string;
  /** Bare tool names to label. */
  tools: string[];
  /** True when the config listed tools; false when they were expanded from a known server. */
  toolsListed: boolean;
  command?: string;
  url?: string;
}

export interface ParsedMcp {
  /** Set when the input already was a ScanConfig — pass-through, not re-labelled. */
  declared?: ScanConfig;
  servers: McpServerEntry[];
}

export const REDACTED = "[redacted]";

/** What the secret pass replaced, so a caller can show the receipt. */
export interface RedactionStats {
  /** String values replaced with `[redacted]` (env values, tokens, URL params, assignments). */
  values: number;
  /** Key-position strings replaced because the name itself looked like a token. */
  names: number;
}

function bump(stats: RedactionStats | undefined, name: boolean): void {
  if (stats === undefined) return;
  if (name) stats.names += 1;
  else stats.values += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : value == null ? undefined : String(value);
}

// ---------------------------------------------------------------------------
// Secret stripping.
// ---------------------------------------------------------------------------

/** A KEY whose value is not safe to keep, whatever it holds. */
const SECRET_KEY_RE = /(token|secret|password|passwd|pwd|api[-_]?key|apikey|authorization|auth[-_]?key|private[-_]?key|access[-_]?key|credential)/i;

/** VALUES that look like credentials even when the key lies about it. */
const SECRET_VALUE_RES: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{10,}/, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{10,}/, // GitHub fine-grained PATs
  /sk-[A-Za-z0-9_-]{10,}/, // OpenAI-style keys
  /sk_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /AKIA[0-9A-Z]{16}/, // AWS access key ids
  /AIza[0-9A-Za-z_-]{20,}/, // Google API keys
  /ya29\.[A-Za-z0-9_-]{10,}/, // Google OAuth
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}/i, // bearer headers in strings
  /\b[0-9a-f]{32,}\b/i, // long hex (tokens, not git shas in practice shorter is fine to keep)
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/, // long base64-ish blobs
];

/** `--token=abc` and `TOKEN=abc` inside a single argv string. */
const ASSIGNMENT_RE = /^([A-Za-z0-9_.-]+)=(.+)$/;

/** `?token=abc` and `&api_key=abc` inside a URL string. */
const URL_PARAM_RE = /([?&][A-Za-z0-9_.-]*(?:token|key|secret|password|passwd|auth)[A-Za-z0-9_.-]*=)([^&\s]+)/gi;

function redactString(value: string, stats?: RedactionStats, name = false): string {
  if (SECRET_VALUE_RES.some((re) => re.test(value))) {
    bump(stats, name);
    return REDACTED;
  }
  const m = ASSIGNMENT_RE.exec(value);
  const key = m?.[1];
  if (key !== undefined && SECRET_KEY_RE.test(key.replace(/^--?/, ""))) {
    bump(stats, name);
    return `${key}=${REDACTED}`;
  }
  return value.replace(URL_PARAM_RE, (_all: string, prefix: string) => {
    bump(stats, name);
    return `${prefix}${REDACTED}`;
  });
}

/** Every env VALUE is replaced; keys are kept because they are what tells you a secret was there. */
function redactEnv(value: unknown, stats?: RedactionStats): unknown {
  if (!isRecord(value)) {
    bump(stats, false);
    return REDACTED;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    bump(stats, false);
    out[key] = REDACTED;
  }
  return out;
}

/**
 * Deep-copy `input` with every secret-shaped string replaced. The returned
 * value never contains a secret that was in the input. Structural shape is
 * preserved so parsers can keep walking it. An optional `stats` counter
 * records what was replaced, for callers that must show a receipt.
 */
export function stripSecrets(input: unknown, stats?: RedactionStats): unknown {
  if (typeof input === "string") return redactString(input, stats);
  if (Array.isArray(input)) return input.map((item) => stripSecrets(item, stats));
  if (isRecord(input)) {
    const out: Record<string, unknown> = {};
    for (const [rawKey, value] of Object.entries(input)) {
      // A key is a string too: server names live in key position, and a
      // pasted config can carry a token there. Redact the key itself.
      const key = redactString(rawKey, stats, true);
      if (/^(env|environment)$/i.test(key)) {
        out[key] = redactEnv(value, stats);
        continue;
      }
      if (SECRET_KEY_RE.test(key)) {
        bump(stats, false);
        out[key] = REDACTED;
        continue;
      }
      out[key] = stripSecrets(value, stats);
    }
    return out;
  }
  return input;
}

// ---------------------------------------------------------------------------
// Ids.
// ---------------------------------------------------------------------------

/** Keep ids inside the schema's ID_PATTERN, no matter what the config says. */
export function safeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "item";
}

/** A unique id in `used`, suffixing -2 -3 ... when the slug collides. */
export function uniqueId(used: Set<string>, base: string): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

function extractToolNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = typeof item === "string" ? item : isRecord(item) ? asString(item["name"]) : undefined;
    if (name === undefined || name === "") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function looksLikeScanConfig(rec: Record<string, unknown>): boolean {
  if (Array.isArray(rec["servers"])) return true;
  return Array.isArray(rec["tools"]) && typeof rec["id"] === "string";
}

/**
 * Accepts a Claude Desktop / VS Code style config (`mcpServers` or `servers`
 * as an object of launch descriptors, optionally with `tools`) and our own
 * ScanConfig (returned as `declared`, untouched except for a copy).
 *
 * When a server entry has no `tools`, its conventional tool set is expanded
 * from `KNOWN_SERVER_TOOLS` (name first, then command+args) and flagged with
 * `toolsListed: false` so the report can say the tool list was inferred.
 */
export function parseClaudeMcp(json: unknown, stats?: RedactionStats): ParsedMcp {
  if (!isRecord(json)) throw new Error("mcp config must be a JSON object");
  const stripped = stripSecrets(json, stats) as Record<string, unknown>;

  if (looksLikeScanConfig(stripped)) {
    const cfg = stripped as unknown as ScanConfig;
    const servers: McpServerEntry[] = (cfg.servers ?? []).map((s) => ({
      id: safeId(String(s.id)),
      name: String(s.name ?? s.id),
      source: "declared",
      tools: (cfg.tools ?? []).filter((t) => t.server === s.id).map((t) => t.name),
      toolsListed: true,
    }));
    return { declared: cfg, servers };
  }

  const rawServers = isRecord(stripped["mcpServers"])
    ? stripped["mcpServers"]
    : isRecord(stripped["servers"])
      ? stripped["servers"]
      : undefined;
  if (rawServers === undefined) {
    throw new Error("not an mcp.json (no mcpServers) and not a ScanConfig");
  }

  const used = new Set<string>();
  const servers: McpServerEntry[] = [];
  for (const [name, rawEntry] of Object.entries(rawServers)) {
    if (!isRecord(rawEntry)) {
      throw new Error(
        `mcpServers['${name}'] must be an object describing how to launch the server (got ${typeName(rawEntry)})`,
      );
    }
    if ("tools" in rawEntry && !Array.isArray(rawEntry["tools"])) {
      throw new Error(`mcpServers['${name}'].tools must be an array of tool names (got ${typeName(rawEntry["tools"])})`);
    }
    const entry = rawEntry;
    const listed = "tools" in entry;
    let tools = extractToolNames(entry["tools"]);
    if (!listed) {
      const args = Array.isArray(entry["args"]) ? entry["args"].map(asString).filter((a): a is string => a !== undefined) : [];
      const byName = expandServerTools(name) ?? expandServerTools(`${asString(entry["command"]) ?? ""} ${args.join(" ")}`);
      if (byName !== undefined) tools = [...byName];
    }
    servers.push({
      id: uniqueId(used, safeId(name)),
      name,
      source: "mcp.json",
      tools,
      toolsListed: listed,
      command: asString(entry["command"]),
      url: asString(entry["url"]),
    });
  }
  return { servers };
}

/** Server names in a pasted config, in declaration order. Never includes secrets. */
export function serverNames(input: unknown): string[] {
  const stripped = stripSecrets(input);
  if (!isRecord(stripped)) return [];
  if (Array.isArray(stripped["servers"])) {
    return stripped["servers"]
      .filter(isRecord)
      .map((s) => asString(s["name"]) ?? asString(s["id"]) ?? "")
      .filter((name) => name !== "");
  }
  const record = isRecord(stripped["mcpServers"]) ? stripped["mcpServers"] : isRecord(stripped["servers"]) ? stripped["servers"] : undefined;
  return record ? Object.keys(record) : [];
}
