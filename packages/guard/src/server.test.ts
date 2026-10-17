/**
 * End to end over stdio: the REAL MCP server, spawned as a child process,
 * initialized, then the three demo calls in order. Call 3 must come back as
 * an error that names the route. Live FalkorDB at localhost:6379.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SERVER = fileURLToPath(new URL("./server.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../data/fixtures/fs-git.json", import.meta.url));
const HOST = process.env["FALKOR_HOST"] ?? "localhost";
const PORT = String(process.env["FALKOR_PORT"] ?? 6379);

interface JsonRpcMessage {
  id?: number;
  // The test reads its own server's responses; `any` keeps the client short.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  result?: any;
  error?: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Bare JSON-RPC 2.0 client over the child's stdio: line-delimited messages. */
class StdioClient {
  private nextId = 1;
  private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
  readonly stderr: string[] = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const text = line.trim();
      if (text === "") return;
      const message = JSON.parse(text) as JsonRpcMessage;
      if (typeof message.id === "number") {
        const resolve = this.pending.get(message.id);
        if (resolve !== undefined) {
          this.pending.delete(message.id);
          resolve(message);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => this.stderr.push(String(chunk)));
  }

  request(method: string, params?: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId;
    this.nextId += 1;
    const answered = new Promise<JsonRpcMessage>((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return answered;
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.stdin.end();
  child.kill("SIGTERM");
  await exited;
}

test(
  "stdio end-to-end: initialize, three calls, the third is blocked",
  { timeout: 60_000 },
  async () => {
    const session = `guard-test-stdio-${Date.now().toString(36)}`;
    const child = spawn(
      process.execPath,
      [SERVER, "--config", FIXTURE, "--session", session, "--host", HOST, "--port", PORT],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const client = new StdioClient(child);
    try {
      const init = await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "guard-test", version: "0.0.1" },
      });
      assert.equal(init.error, undefined, `initialize failed: ${JSON.stringify(init.error)}`);
      assert.ok(init.result?.serverInfo?.name, "server must introduce itself");
      client.notify("notifications/initialized");

      const listed = await client.request("tools/list", {});
      const names = (listed.result?.tools as Array<{ name: string }>)
        .map((tool) => tool.name)
        .sort();
      assert.deepEqual(names, ["filesystem.read", "git.push", "github.read"]);

      const read = await client.request("tools/call", {
        name: "github.read",
        arguments: { query: "issue#42" },
      });
      assert.notEqual(read.result?.isError, true, `call 1 must be allowed: ${JSON.stringify(read.result)}`);

      const folder = await client.request("tools/call", {
        name: "filesystem.read",
        arguments: { path: "~/work/stats" },
      });
      assert.notEqual(folder.result?.isError, true, `call 2 must be allowed: ${JSON.stringify(folder.result)}`);

      const push = await client.request("tools/call", {
        name: "git.push",
        arguments: { target: "main", content: "the daily report" },
      });
      assert.equal(push.result?.isError, true, `call 3 must be blocked: ${JSON.stringify(push.result)}`);
      const text = String(push.result?.content?.[0]?.text ?? "");
      assert.match(text, /untrusted input and private data/);
      assert.match(text, /route: github issue → github\.read → context → git\.push → public repo/);
    } finally {
      await stop(child);
    }
  },
);
