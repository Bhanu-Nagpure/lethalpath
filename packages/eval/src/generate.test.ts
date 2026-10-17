/**
 * Generator checks. No database: these run anywhere.
 *
 * The four the task pins down are here — determinism, every config passes
 * validateScanConfig, the tie cases really expect different sides, and every
 * route case carries the trifecta (untrusted resource, private resource,
 * public sink) — plus the construction invariants the two live suites rely
 * on (one planted route per route case, an empty cut story for clean cases).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { validateScanConfig } from "@lethalpath/schema";

import {
  DEFAULT_SEED,
  caseMix,
  hasLinkHalfs,
  makeCases,
  plantedRoute,
  type Case,
} from "./generate.js";

const cases = makeCases(DEFAULT_SEED, 40);
const routeKinds = new Set(["leak", "laundering", "tie"]);

function countUses(c: Case, tool: string): number {
  return (c.config.tasks ?? []).filter((t) => t.uses.includes(tool)).length;
}

test("same seed produces byte-identical cases", () => {
  const again = makeCases(DEFAULT_SEED, 40);
  assert.equal(JSON.stringify(again), JSON.stringify(cases));
  assert.equal(JSON.stringify(makeCases()), JSON.stringify(cases));
});

test("the default mix is 16 leak / 8 laundering / 8 clean / 8 tie", () => {
  assert.deepEqual(caseMix(40), { leak: 16, laundering: 8, clean: 8, tie: 8 });
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  assert.equal(counts.get("leak"), 16);
  assert.equal(counts.get("laundering"), 8);
  assert.equal(counts.get("clean"), 8);
  assert.equal(counts.get("tie"), 8);
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "case ids unique");
});

test("every generated config passes validateScanConfig", () => {
  for (const c of cases) {
    const problems = validateScanConfig(c.config);
    assert.deepEqual(problems, [], `${c.id} must be valid: ${problems.join("; ")}`);
  }
});

test("every route case carries the trifecta: untrusted, private, public sink", () => {
  for (const c of cases.filter((c) => routeKinds.has(c.kind))) {
    const resources = c.config.resources;
    assert.ok(
      resources.some((r) => r.trust === "untrusted"),
      `${c.id} needs an untrusted resource`,
    );
    assert.ok(
      resources.some((r) => r.sensitivity === "private"),
      `${c.id} needs a private resource`,
    );
    assert.ok(
      resources.some((r) => r.visibility === "public"),
      `${c.id} needs a public sink`,
    );
  }
});

test("tie cases expect the read side and the write side across the set", () => {
  const tie = cases.filter((c) => c.kind === "tie");
  assert.equal(tie.length, 8);
  let read = 0;
  let write = 0;
  for (const c of tie) {
    const planted = plantedRoute(c.config);
    assert.ok(planted, `${c.id} must expose one planted route`);
    const expected = c.truth.expectedGrants[0];
    if (expected === planted.reader) read += 1;
    else if (expected === planted.writer) write += 1;
    else assert.fail(`${c.id} expects '${expected}', neither the reader nor the writer`);
  }
  assert.equal(read, 4, "half the tie cases expect the read side");
  assert.equal(write, 4, "half the tie cases expect the write side");
  assert.ok(read > 0 && write > 0, "both sides present across the set");
});

test("route-case ground truth is the documented rule on constructed costs", () => {
  for (const c of cases.filter((c) => routeKinds.has(c.kind))) {
    const planted = plantedRoute(c.config);
    assert.ok(planted, `${c.id} must expose exactly one planted route`);
    assert.equal(c.truth.hasRoute, true, `${c.id} has a route`);
    const readerCost = countUses(c, planted.reader);
    const writerCost = countUses(c, planted.writer);
    // Cheaper side wins; equal costs hand the tie to the write side.
    const rule = readerCost < writerCost ? planted.reader : planted.writer;
    assert.deepEqual(c.truth.expectedGrants, [rule], `${c.id} expected grant`);
    const tasksKept = (c.config.tasks ?? []).filter(
      (t) => !t.uses.includes(rule),
    ).length;
    assert.equal(c.truth.expectedTasksKept, tasksKept, `${c.id} tasks kept`);
    assert.equal(c.truth.expectedTasksTotal, (c.config.tasks ?? []).length);
  }
});

test("clean cases break exactly one half of the private->public link", () => {
  for (const c of cases.filter((c) => c.kind === "clean")) {
    assert.equal(c.truth.hasRoute, false, `${c.id} has no route`);
    assert.deepEqual(c.truth.expectedGrants, [], `${c.id} expects no grants`);
    assert.equal(c.truth.expectedTasksKept, (c.config.tasks ?? []).length);
    assert.equal(c.truth.expectedTasksTotal, (c.config.tasks ?? []).length);
    const halves = hasLinkHalfs(c.config);
    assert.ok(
      !(halves.readsPrivate && halves.writesPublic),
      `${c.id} must miss a reader of a private resource or a writer of a public sink`,
    );
  }
});

test("route cases keep a single private reader and a single public writer", () => {
  for (const c of cases.filter((c) => routeKinds.has(c.kind))) {
    const privates = c.config.resources.filter((r) => r.sensitivity === "private");
    const publics = c.config.resources.filter((r) => r.visibility === "public");
    assert.equal(privates.length, 1, `${c.id} exactly one private resource`);
    assert.equal(publics.length, 1, `${c.id} exactly one public sink`);
  }
});
