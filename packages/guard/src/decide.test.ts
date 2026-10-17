/**
 * The rule, from both ends: a poisoned session gets blocked, the same call on
 * a fresh session is allowed, deny wins over everything, and the audit graph
 * proves nothing but a hash of the arguments survived. All of it runs against
 * the live FalkorDB at localhost:6379.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GraphDB } from "@lethalpath/core";
import type { ScanConfig } from "@lethalpath/schema";

import { Guard, decideCall } from "./index.js";
import { EMPTY_POLICY, parsePolicy, validatePolicy } from "./policy.js";
import { explainRoute } from "./route.js";
import { argsHash } from "./session.js";

const FIXTURE = fileURLToPath(new URL("../../../data/fixtures/fs-git.json", import.meta.url));
const HOST = process.env["FALKOR_HOST"] ?? "localhost";
const PORT = Number(process.env["FALKOR_PORT"] ?? 6379);

function loadFixture(): ScanConfig {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as ScanConfig;
}

function sessionId(label: string): string {
  return `guard-test-${label}-${Date.now().toString(36)}`;
}

test("explainRoute walks untrusted → reader → context → called tool → public sink", () => {
  const cfg = loadFixture();
  assert.deepEqual(explainRoute(cfg, "git.push"), [
    "github issue",
    "github.read",
    "context",
    "git.push",
    "public repo",
  ]);
  assert.equal(explainRoute(cfg, "github.read"), null, "github.read writes nothing public");
  assert.equal(explainRoute(cfg, "no.such.tool"), null, "undeclared tool has no route");
});

test("poisoned session: reads are allowed, the push is blocked with the route", async () => {
  const cfg = loadFixture();
  const guard = new Guard(cfg, EMPTY_POLICY, { sessionId: sessionId("poison"), host: HOST, port: PORT });
  try {
    const read = await guard.decide("github.read", { query: "issue#42" });
    assert.equal(read.decision, "allowed");
    assert.equal(read.rule, "default");
    assert.deepEqual([...guard.taint], ["untrusted"]);

    const folder = await guard.decide("filesystem.read", { path: "~/work/stats" });
    assert.equal(folder.decision, "allowed");
    assert.deepEqual([...guard.taint].sort(), ["private", "untrusted"]);

    const push = await guard.decide("git.push", { target: "main", content: "the daily report" });
    assert.equal(push.decision, "blocked");
    assert.equal(push.rule, "taint");
    assert.ok(push.route !== undefined && push.route.includes("git.push"));
    assert.deepEqual(push.route, ["github issue", "github.read", "context", "git.push", "public repo"]);
    assert.match(push.reason, /untrusted input and private data/);
    assert.match(push.reason, /route: github issue → github\.read → context → git\.push → public repo/);
  } finally {
    await guard.close();
  }
});

test("fresh session: the same push is allowed — the arrangement is what makes it lethal", async () => {
  const cfg = loadFixture();
  const guard = new Guard(cfg, EMPTY_POLICY, { sessionId: sessionId("fresh"), host: HOST, port: PORT });
  try {
    const push = await guard.decide("git.push", { target: "main", content: "the daily report" });
    assert.equal(push.decision, "allowed");
    assert.equal(push.rule, "default");
    assert.equal(push.route, undefined);
    assert.deepEqual([...guard.taint], []);
  } finally {
    await guard.close();
  }
});

test("policy deny blocks even a clean session and wins over the taint route", () => {
  const cfg = loadFixture();

  const clean = decideCall(cfg, { deny: ["git.push"], note: "release freeze" }, new Set(), "git.push");
  assert.equal(clean.decision, "blocked");
  assert.equal(clean.rule, "policy-deny");
  assert.equal(clean.route, undefined);
  assert.match(clean.reason, /release freeze/);

  const tainted = decideCall(
    cfg,
    { deny: ["git.push"] },
    new Set(["untrusted", "private"]),
    "git.push",
  );
  assert.equal(tainted.decision, "blocked");
  assert.equal(tainted.rule, "policy-deny", "deny short-circuits before the taint rule");

  const read = decideCall(cfg, EMPTY_POLICY, new Set(["untrusted", "private"]), "github.read");
  assert.equal(read.decision, "allowed", "a read tool cannot exfiltrate, so taint never blocks it");
});

test("policy parsing is strict and loud", () => {
  assert.deepEqual(parsePolicy('{"deny":["git.push"],"note":"freeze"}'), {
    deny: ["git.push"],
    note: "freeze",
  });
  assert.deepEqual(validatePolicy({ deny: [] }), []);
  assert.throws(() => parsePolicy('{"deny":"git.push"}'), /deny/);
  assert.throws(() => parsePolicy('{"deny":["a","a"]}'), /duplicates/);
  assert.throws(() => parsePolicy('{"deny":[],"extra":1}'), /unknown key/);
  assert.throws(() => parsePolicy("{not json"), /not valid JSON/);
});

test("audit holds a hash, never the arguments — and a blocked step moves nothing", async () => {
  const cfg = loadFixture();
  const id = sessionId("audit");
  const secretQuery = "TOP-SECRET-QUERY-9b2c";
  const secretPath = "/home/bhd/private/stats-MARKER-7f3a.json";
  const secretPayload = "DO-NOT-STORE-PAYLOAD-c4d1";

  const guard = new Guard(cfg, EMPTY_POLICY, { sessionId: id, host: HOST, port: PORT });
  try {
    await guard.decide("github.read", { query: secretQuery });
    await guard.decide("filesystem.read", { path: secretPath });
    const push = await guard.decide("git.push", { target: "main", content: secretPayload });
    assert.equal(push.decision, "blocked");
  } finally {
    await guard.close();
  }

  const db = await GraphDB.open(`sessions_${id}`, HOST, PORT);
  try {
    const steps = (
      await db.read(
        `MATCH (:Session {id: $sid})-[:STEP]->(st:Step)
         RETURN st.tool AS tool, st.decision AS decision, st.reason AS reason,
                st.argsHash AS argsHash, st.ts AS ts, keys(st) AS props`,
        { sid: id },
      )
    ).rows;
    assert.equal(steps.length, 3);

    const forbidden = [secretQuery, secretPath, secretPayload, "/home/bhd/private"];
    for (const step of steps) {
      for (const value of Object.values(step)) {
        const text = JSON.stringify(value);
        for (const needle of forbidden) {
          assert.ok(!text.includes(needle), `step property leaked '${needle}': ${text}`);
        }
      }
      const props = step["props"];
      assert.ok(Array.isArray(props));
      assert.deepEqual([...props].sort(), ["argsHash", "decision", "id", "reason", "tool", "ts"]);
      assert.match(String(step["argsHash"]), /^[0-9a-f]{16}$/);
    }

    const byTool = new Map(steps.map((step) => [String(step["tool"]), step]));
    assert.equal(byTool.get("github.read")?.["argsHash"], argsHash({ query: secretQuery }));
    assert.equal(byTool.get("git.push")?.["decision"], "blocked");
    assert.match(String(byTool.get("git.push")?.["reason"]), /route: .*git\.push → public repo/);

    // READ edges: exactly the allowed reads. The blocked push wrote nothing.
    const readEdges = (
      await db.read(
        `MATCH (:Session {id: $sid})-[:STEP]->(st:Step)-[:READ]->(r:Resource)
         RETURN st.tool AS tool, r.id AS resource`,
        { sid: id },
      )
    ).rows.map((row) => `${String(row["tool"])}:${String(row["resource"])}`);
    assert.deepEqual(readEdges.sort(), ["filesystem.read:files", "github.read:issue"]);

    const wrote = await db.read(
      `MATCH (:Session {id: $sid})-[:STEP]->(st:Step)-[:WROTE]->(:Resource) RETURN count(*) AS n`,
      { sid: id },
    );
    assert.equal(Number(wrote.rows[0]?.["n"] ?? -1), 0);
  } finally {
    await db.close();
  }
});

test("arguments too deep to hash are still audited, marked unhashable", async () => {
  const cfg = loadFixture();
  const id = sessionId("deep");
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < 200_000; i += 1) {
    const next: Record<string, unknown> = {};
    cursor["n"] = next;
    cursor = next;
  }

  const guard = new Guard(cfg, EMPTY_POLICY, { sessionId: id, host: HOST, port: PORT });
  try {
    const read = await guard.decide("github.read", root);
    assert.equal(read.decision, "allowed");
  } finally {
    await guard.close();
  }

  const db = await GraphDB.open(`sessions_${id}`, HOST, PORT);
  try {
    const steps = (
      await db.read(
        `MATCH (:Session {id: $sid})-[:STEP]->(st:Step)
         RETURN st.tool AS tool, st.argsHash AS argsHash`,
        { sid: id },
      )
    ).rows;
    assert.equal(steps.length, 1, "the call must leave a Step even when it cannot be hashed");
    assert.equal(steps[0]?.["tool"], "github.read");
    assert.equal(steps[0]?.["argsHash"], "unhashable");
  } finally {
    await db.close();
  }
});
