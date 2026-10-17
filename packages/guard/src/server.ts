#!/usr/bin/env node
/**
 * lethalpath guard — the runtime half, speaking MCP over stdio.
 *
 * The scan says which ARRANGEMENT of permissions leaks; this process fronts
 * the same tools a live agent session would call. Every call goes through
 * Guard.decide(): allowed calls answer with a canned FAKE result (the demo
 * never carries real content), blocked calls answer isError with the reason
 * and the route as text.
 *
 * Protocol: MCP over stdio — JSON-RPC 2.0, newline-delimited on stdout.
 * stdout belongs to the protocol; every diagnostic goes to stderr.
 *
 *   node dist/server.js --config data/fixtures/fs-git.json [--policy policy.json]
 *                       [--session demo] [--host localhost] [--port 6379]
 *
 * Exit 1 only on startup failure. A blocked call is an ANSWER, not a crash.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ScanConfig, ToolDecl } from "@lethalpath/schema";

import { EMPTY_POLICY, Guard, describeTaint, loadPolicy, type Policy } from "./index.js";

const USAGE = `lethalpath guard — MCP stdio server
usage: node dist/server.js --config <config.json> [--policy policy.json]
                           [--session <id>] [--host <host>] [--port <port>]
  --config   scan config to front (default data/fixtures/fs-git.json)
  --policy   policy.json with a deny list (default: nothing pre-denied)
  --session  audit graph suffix: sessions_<id> (default: time-based)
  --host     FalkorDB host (default localhost)
  --port     FalkorDB port (default 6379)`;

interface Options {
  config: string;
  policy: string | undefined;
  session: string;
  host: string;
  port: number;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    config: "data/fixtures/fs-git.json",
    policy: undefined,
    session: `guard-${Date.now().toString(36)}`,
    host: "localhost",
    port: 6379,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];
    if (token === "--config" && value !== undefined) {
      opts.config = value;
      i += 1;
    } else if (token === "--policy" && value !== undefined) {
      opts.policy = value;
      i += 1;
    } else if (token === "--session" && value !== undefined) {
      opts.session = value;
      i += 1;
    } else if (token === "--host" && value !== undefined) {
      opts.host = value;
      i += 1;
    } else if (token === "--port" && value !== undefined) {
      opts.port = Number(value);
      i += 1;
    } else {
      throw new Error(`unknown argument '${String(token)}'\n${USAGE}`);
    }
  }
  return opts;
}

interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: boolean;
}

/** Read tools take {path or query}; write tools take {target, content}. */
function inputSchemaFor(tool: ToolDecl): ToolInputSchema {
  if (tool.writes.length > 0) {
    return {
      type: "object",
      properties: {
        target: { type: "string", description: "where the write lands (branch, destination)" },
        content: { type: "string", description: "the payload being written" },
      },
      required: ["target"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      path: { type: "string", description: "resource locator to read (folder, file)" },
      query: { type: "string", description: "query to run against the resource (issue, search)" },
    },
    additionalProperties: false,
  };
}

function kindOf(cfg: ScanConfig, resourceId: string): string {
  return cfg.resources.find((resource) => resource.id === resourceId)?.kind ?? resourceId;
}

function toolDescription(cfg: ScanConfig, tool: ToolDecl): string {
  const server = cfg.servers.find((candidate) => candidate.id === tool.server)?.name ?? tool.server;
  const reads = tool.reads.map((id) => kindOf(cfg, id));
  const writes = tool.writes.map((id) => kindOf(cfg, id));
  return `${server}: ${tool.name}. reads: ${reads.length > 0 ? reads.join(", ") : "—"}; writes: ${
    writes.length > 0 ? writes.join(", ") : "—"
  }`;
}

function toolList(cfg: ScanConfig): Array<{ name: string; description: string; inputSchema: ToolInputSchema }> {
  return cfg.tools.map((tool) => ({
    name: tool.name,
    description: toolDescription(cfg, tool),
    inputSchema: inputSchemaFor(tool),
  }));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(readFileSync(resolve(opts.config), "utf8")) as ScanConfig;
  const policy: Policy = opts.policy === undefined ? EMPTY_POLICY : loadPolicy(opts.policy);
  const guard = new Guard(cfg, policy, {
    sessionId: opts.session,
    host: opts.host,
    port: opts.port,
  });

  const server = new Server(
    { name: "lethalpath-guard", version: "0.0.1" },
    { capabilities: { tools: {} }, instructions: "LethalPath guard: blocks calls that would carry this session's taint to a public sink." },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList(cfg) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args: unknown = request.params.arguments ?? {};
    if (!cfg.tools.some((tool) => tool.name === name)) {
      return {
        content: [{ type: "text", text: `unknown tool '${name}' — this guard only fronts scan '${cfg.id}'` }],
        isError: true,
      };
    }

    const decision = await guard.decide(name, args);
    if (decision.decision === "blocked") {
      return { content: [{ type: "text", text: decision.reason }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `[FAKE] ${name} executed against the '${cfg.id}' fixture — synthetic result, no real content. session taint: ${describeTaint(
            guard.taint,
          )}`,
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `lethalpath guard: scan '${cfg.id}' · sessions_${guard.sessionId} · ${policy.deny.length} pre-denied · ${cfg.tools.length} tools`,
  );

  server.onclose = () => {
    void guard.close().catch(() => undefined);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void guard.close().finally(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(`lethalpath guard: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
