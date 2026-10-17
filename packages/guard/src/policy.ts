/**
 * policy.json — the one place a human pre-refuses a tool.
 *
 * Shape: { "deny": ["git.push", …], "note"?: "why this list exists" }
 *
 * Deny wins over everything: it is checked before taint, so a denied tool is
 * refused even on a clean session. There is deliberately no allow list — an
 * "allow" could only exist to bypass the taint rule, and bypassing taint is
 * the one thing the guard must never do. Validation is strict and loud: a
 * policy that fails to parse refuses to load rather than being ignored.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Policy {
  /** Tool names refused before any other check. Order has no meaning. */
  deny: string[];
  /** One line carried into every denial reason. */
  note?: string;
}

/** The policy when a run passes none: nothing pre-denied. */
export const EMPTY_POLICY: Policy = { deny: [] };

export function validatePolicy(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ['policy must be a JSON object: { "deny": [toolNames], "note"?: string }'];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];

  const deny = record["deny"];
  if (!Array.isArray(deny)) {
    problems.push("policy.deny is required and must be an array of tool names");
  } else {
    const seen = new Set<string>();
    deny.forEach((entry, i) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        problems.push(`policy.deny[${i}] must be a non-empty tool name`);
      } else if (seen.has(entry)) {
        problems.push(`policy.deny[${i}] duplicates '${entry}'`);
      } else {
        seen.add(entry);
      }
    });
  }

  const note = record["note"];
  if (note !== undefined && typeof note !== "string") {
    problems.push("policy.note must be a string when present");
  }
  for (const key of Object.keys(record)) {
    if (key !== "deny" && key !== "note") problems.push(`policy has unknown key '${key}'`);
  }
  return problems;
}

export function parsePolicy(raw: string, source = "policy"): Policy {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
  }
  const problems = validatePolicy(value);
  if (problems.length > 0) throw new Error(`${source} refused: ${problems.join("; ")}`);
  const record = value as { deny: string[]; note?: string };
  return record.note === undefined ? { deny: [...record.deny] } : { deny: [...record.deny], note: record.note };
}

export function loadPolicy(path: string): Policy {
  const full = resolve(path);
  return parsePolicy(readFileSync(full, "utf8"), full);
}
