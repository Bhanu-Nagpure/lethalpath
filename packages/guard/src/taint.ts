/**
 * Taint — what a session's context has absorbed so far.
 *
 * The scan graph says which ARRANGEMENT of permissions leaks. The guard
 * watches what one live session actually absorbed and refuses the call that
 * would carry it out. Two labels exist, both fixed by the scan config:
 *
 *   trust 'untrusted'      → "untrusted"   an attacker can write this text
 *   sensitivity 'private'  → "private"     it must never reach a public sink
 *
 * The block rule needs BOTH. Untrusted input alone is noise; private data
 * alone has no attacker steering it anywhere. Together, a write to a public
 * sink is exfiltration — and the same write on a clean session is just work.
 */

import type { ResourceDecl } from "@lethalpath/schema";

export type TaintLabel = "untrusted" | "private";

/** Fixed order so reasons and transcripts read the same every time. */
export const TAINT_ORDER: readonly TaintLabel[] = ["untrusted", "private"];

/** The labels a resource contributes when it is read into the context. */
export function labelsForResource(res: ResourceDecl): TaintLabel[] {
  const labels: TaintLabel[] = [];
  if (res.trust === "untrusted") labels.push("untrusted");
  if (res.sensitivity === "private") labels.push("private");
  return labels;
}

/** The freeze condition: both labels, or nothing to block. */
export function holdsBoth(taint: ReadonlySet<string>): boolean {
  return taint.has("untrusted") && taint.has("private");
}

/** Human form for reasons and transcripts: "none", "untrusted", "untrusted + private". */
export function describeTaint(taint: ReadonlySet<string>): string {
  const held = TAINT_ORDER.filter((label) => taint.has(label));
  return held.length === 0 ? "none" : held.join(" + ");
}
