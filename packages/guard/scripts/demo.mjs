#!/usr/bin/env node
/**
 * lethalpath guard — the demo transcript, printed from the real thing.
 *
 * Spawns packages/guard/dist/server.js over stdio, initializes it, and drives
 * the four calls the presentation quotes. Everything below the header line is
 * the server's own JSON-RPC answer; nothing here is canned except the header.
 * Exits 1 if the poisoned push is not blocked, or if the same push on a
 * fresh session is not allowed.
 *
 *   node scripts/demo.mjs [policy.json]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// Style helpers no-op unless a real terminal is watching, so a piped demo
// transcript stays plain text.
import { bold, green, red } from "@lethalpath/core";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..", "..");
const SERVER = resolve(here, "..", "dist", "server.js");
const CONFIG = resolve(ROOT, "data", "fixtures", "fs-git.json");

const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
const policyPath = process.argv[2] === undefined ? null : resolve(process.argv[2]);
const denyCount =
  policyPath === null ? 0 : (JSON.parse(readFileSync(policyPath, "utf8")).deny ?? []).length;

const PUSH_ARGS = { target: "main", content: "the daily report" };
const READ_CALLS = [
  { tool: "github.read", args: { query: "issue#42" } },
  { tool: "filesystem.read", args: { path: "~/work/stats" } },
];

const LABEL = 12; // "call 1      " — width of the call-number column
const EXPR = 34; // width of the call-expression column
const ROUTE_SEP = " · route: ";
const pad = (text, width) => String(text).padEnd(width);
const indent = " ".repeat(LABEL);

/** Bare JSON-RPC 2.0 client over the child's stdio (line-delimited). */
class GuardClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const text = line.trim();
      if (text === "") return;
      const message = JSON.parse(text);
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const resolve = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve(message);
      }
    });
    child.stderr.on("data", (chunk) => this.stderr.push(String(chunk)));
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    const answered = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return answered;
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
}

async function start(session) {
  const args = [SERVER, "--config", CONFIG, "--session", session];
  if (policyPath !== null) args.push("--policy", policyPath);
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  const client = new GuardClient(child);
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lethalpath-demo", version: "0.0.1" },
  });
  if (init.error !== undefined) {
    throw new Error(`initialize failed: ${JSON.stringify(init.error)} — stderr: ${client.stderr.join("")}`);
  }
  client.notify("notifications/initialized");
  return { child, client };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", () => resolve()));
  child.stdin.end();
  child.kill("SIGTERM");
  await exited;
}

async function invoke(client, tool, args) {
  const message = await client.request("tools/call", { name: tool, arguments: args });
  if (message.error !== undefined) {
    throw new Error(`${tool} failed at the protocol level: ${JSON.stringify(message.error)} — stderr: ${client.stderr.join("")}`);
  }
  const result = message.result ?? {};
  return { blocked: result.isError === true, text: result.content?.[0]?.text ?? "" };
}

function callExpr(tool, args) {
  const locator = args.query ?? args.path ?? args.target ?? "";
  return locator === "" ? tool : `${tool}(${locator})`;
}

function verdict(result) {
  if (result.blocked) return bold(red("BLOCKED"));
  const taint = /session taint: (.*)$/m.exec(result.text)?.[1] ?? "unknown";
  return `${green(bold("ALLOWED"))} · taint: ${taint}`;
}

function splitReason(text) {
  const at = text.indexOf(ROUTE_SEP);
  return at === -1 ? [text, null] : [text.slice(0, at), text.slice(at + ROUTE_SEP.length)];
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("demo: timed out after 60 s");
    process.exit(1);
  }, 60_000);
  watchdog.unref();

  console.log(
    `guard       stdio MCP server · scan_${cfg.id} · sessions_demo · policy: ${denyCount} pre-denied`,
  );
  let failed = false;

  const first = await start("demo");
  try {
    for (let i = 0; i < READ_CALLS.length; i += 1) {
      const call = READ_CALLS[i];
      const result = await invoke(first.client, call.tool, call.args);
      if (result.blocked) {
        failed = true;
        console.error(`demo: call ${i + 1} (${call.tool}) should be allowed — ${result.text}`);
      }
      console.log(`${pad(`call ${i + 1}`, LABEL)}${pad(callExpr(call.tool, call.args), EXPR)}${verdict(result)}`);
    }

    const push = await invoke(first.client, "git.push", PUSH_ARGS);
    console.log(`${pad("call 3", LABEL)}${pad(callExpr("git.push", PUSH_ARGS), EXPR)}${verdict(push)}`);
    if (push.blocked) {
      const [why, route] = splitReason(push.text);
      if (route !== null) console.log(`${indent}route  ${route}`);
      console.log(`${indent}why    ${why}`);
    } else {
      failed = true;
      console.error(`demo: call 3 (git.push) should be blocked — ${push.text}`);
    }
  } finally {
    await stop(first.child);
  }

  const fresh = await start("demo-fresh");
  try {
    const push = await invoke(fresh.client, "git.push", PUSH_ARGS);
    if (push.blocked) {
      failed = true;
      console.error(`demo: call 4 (git.push, fresh session) should be allowed — ${push.text}`);
    }
    console.log(
      `${pad("call 4", LABEL)}${pad(`${callExpr("git.push", PUSH_ARGS)} [fresh session]`, EXPR)}${verdict(push)}`,
    );
  } finally {
    await stop(fresh.child);
  }

  clearTimeout(watchdog);
  if (failed) {
    console.error("demo: the transcript does not match the frozen rule (see above)");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`demo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
