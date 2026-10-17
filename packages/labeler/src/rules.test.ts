/**
 * Rule tests. No database, no network — the labeler is pure by design.
 *
 * 1. The gold set (gold/labels.csv): every hand-written row must resolve to
 *    its expected resource ids. Agreement is printed and must stay >= 0.85.
 * 2. An unknown tool must land in `unlabelled` at conf <= 0.2 and still
 *    produce a valid ScanConfig.
 * 3. A hostile mcp.json must not leak env values anywhere in the output.
 * 4. Every conventional tool set in KNOWN_SERVER_TOOLS must itself be fully
 *    labelled — if a row expands to a tool the rules cannot read, that is a
 *    bug in the package, not a curiosity.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateScanConfig, type ScanConfig } from "@lethalpath/schema";

import { labelConfig } from "./index.js";
import { parseClaudeMcp, serverNames, stripSecrets } from "./mcp.js";
import { KNOWN_SERVER_TOOLS } from "./rules.js";

interface GoldRow {
  toolName: string;
  expected: string[];
  note: string;
}

function readGold(): GoldRow[] {
  const text = readFileSync(new URL("../gold/labels.csv", import.meta.url), "utf8");
  const rows: GoldRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("toolName,")) continue;
    const [toolName = "", expected = "", note = ""] = trimmed.split(",");
    rows.push({
      toolName,
      expected: expected.split(";").map((s) => s.trim()).filter((s) => s !== ""),
      note,
    });
  }
  return rows;
}

function goldToolName(toolName: string): { server: string; tool: string; full: string } {
  const dot = toolName.indexOf(".");
  if (dot > 0 && dot < toolName.length - 1) {
    const server = toolName.slice(0, dot);
    const tool = toolName.slice(dot + 1);
    return { server, tool, full: `${server}.${tool}` };
  }
  return { server: "gold", tool: toolName, full: `gold.${toolName}` };
}

test("gold set: every row resolves to its expected resources", () => {
  const rows = readGold();
  const servers = new Map<string, string[]>();
  for (const row of rows) {
    const { server, tool } = goldToolName(row.toolName);
    const tools = servers.get(server) ?? [];
    tools.push(tool);
    servers.set(server, tools);
  }
  const mcpJson = {
    mcpServers: Object.fromEntries(
      [...servers.entries()].map(([name, tools]) => [name, { command: "npx", tools }]),
    ),
  };

  const result = labelConfig(mcpJson);
  assert.deepEqual(validateScanConfig(result.config), []);
  const byName = new Map(result.config.tools.map((t) => [t.name, t]));

  const misses: string[] = [];
  let hits = 0;
  for (const row of rows) {
    const tool = byName.get(goldToolName(row.toolName).full);
    const actual = new Set(tool ? [...tool.reads, ...tool.writes] : []);
    const missing = row.expected.filter((id) => !actual.has(id));
    if (tool !== undefined && missing.length === 0) {
      hits += 1;
    } else {
      misses.push(`${row.toolName} (${row.note}) expected [${row.expected.join("; ")}] got [${[...actual].join("; ")}]${tool ? "" : " — NO TOOL"}`);
    }
  }
  const ratio = hits / rows.length;
  console.log(`gold ${hits}/${rows.length}`);
  for (const miss of misses) console.log(`  MISS ${miss}`);
  assert.ok(ratio >= 0.85, `gold agreement ${hits}/${rows.length} (${ratio.toFixed(2)}) is below 0.85`);
});

test("unknown tool: unlabelled, conf <= 0.2, config still valid", () => {
  const result = labelConfig({
    mcpServers: { weird: { command: "npx", tools: ["mystery_tool"] } },
  });
  assert.deepEqual(result.unlabelled, ["weird.mystery_tool"]);
  const tool = result.config.tools.find((t) => t.name === "weird.mystery_tool");
  assert.ok(tool, "the unknown tool must still be a tool in the config");
  assert.ok(tool.labelConf <= 0.2, `conf ${tool.labelConf} must be <= 0.2`);
  assert.deepEqual(tool.reads, ["unknown-tool-output"]);
  assert.deepEqual(tool.writes, []);
  assert.deepEqual(validateScanConfig(result.config), []);
});

test("hostile mcp.json: env values and tokens never survive", () => {
  const hostile = {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github", "--api-key=supersecret"],
        env: { TOKEN: "supersecret", GITHUB_TOKEN: "ghp_abcdefghijklmnopqrst0123456789" },
        url: "https://mcp.example.com/sse?token=supersecret",
      },
    },
  };

  const result = labelConfig(hostile);
  const blob = JSON.stringify(result);
  assert.ok(!blob.includes("supersecret"), "env value leaked into the label result");
  assert.ok(!blob.includes("ghp_abcdefghijklmnopqrst0123456789"), "token leaked into the label result");

  const stripped = JSON.stringify(stripSecrets(hostile));
  assert.ok(!stripped.includes("supersecret"), "stripSecrets left the env value in");

  const parsed = JSON.stringify(parseClaudeMcp(hostile));
  assert.ok(!parsed.includes("supersecret"), "parseClaudeMcp left a secret in");
  assert.ok(!parsed.includes("ghp_abcdefghijklmnopqrst0123456789"), "parseClaudeMcp left the token in");

  assert.deepEqual(serverNames(hostile), ["github"]);
});

test("known server expansions are fully labelled", () => {
  for (const known of KNOWN_SERVER_TOOLS) {
    const name = known.match[0];
    if (name === undefined) continue;
    const result = labelConfig({ mcpServers: { [name]: { command: "npx" } } });
    assert.equal(
      result.unlabelled.length,
      0,
      `server '${name}' expands to tools the rules cannot read: ${result.unlabelled.join(", ")}`,
    );
    assert.ok(result.config.tools.length > 0, `server '${name}' expanded to no tools`);
    assert.deepEqual(validateScanConfig(result.config), []);
  }
});

test("ScanConfig input passes through labelled", () => {
  const declared: ScanConfig = {
    id: "declared-1",
    title: "declared",
    servers: [{ id: "s", name: "S", source: "test" }],
    resources: [{ id: "r", kind: "thing" }],
    tools: [{ name: "s.t", server: "s", reads: ["r"], writes: [], labelSource: "declared", labelConf: 1 }],
  };
  const result = labelConfig(declared);
  assert.deepEqual(result.unlabelled, []);
  assert.deepEqual(result.config, declared);
});
