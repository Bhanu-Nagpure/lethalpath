/**
 * The route walker — the scan graph, reduced to plain TypeScript.
 *
 * FalkorDB holds the real graph (built by @lethalpath/core `ingest`), but the
 * guard sits in front of every tool call and must explain a block without a
 * round trip. The routes it reports are structural facts of the CONFIG: the
 * same arrangement the scan walks, computed from the same file.
 *
 * The chain the guard reports:
 *
 *   untrusted resource → tool that reads it → context → called tool → public sink
 *
 * e.g. ["github issue", "github.read", "context", "git.push", "public repo"]
 *
 * Deterministic by construction: first match in config order, so the same
 * config always yields the same route string.
 */

import type { ResourceDecl, ScanConfig, ToolDecl } from "@lethalpath/schema";

/** Same value as CONTEXT_ID in @lethalpath/core; kept local so this file stays pure. */
const CONTEXT_LABEL = "context";

export function toolDecl(cfg: ScanConfig, name: string): ToolDecl | undefined {
  return cfg.tools.find((tool) => tool.name === name);
}

export function resourceDecl(cfg: ScanConfig, id: string): ResourceDecl | undefined {
  return cfg.resources.find((resource) => resource.id === id);
}

/** Resources a tool writes that anyone can read, in config order. */
export function publicSinkWrites(cfg: ScanConfig, toolName: string): ResourceDecl[] {
  const tool = toolDecl(cfg, toolName);
  if (tool === undefined) return [];
  const sinks: ResourceDecl[] = [];
  for (const id of tool.writes) {
    const resource = resourceDecl(cfg, id);
    if (resource !== undefined && resource.visibility === "public") sinks.push(resource);
  }
  return sinks;
}

/**
 * One chain from an untrusted resource, through the tool that reads it and
 * the context, to the called tool and the public sink it writes. Null when
 * no such chain exists — then nothing about this call is a leak route.
 */
export function explainRoute(cfg: ScanConfig, calledTool: string): string[] | null {
  const called = toolDecl(cfg, calledTool);
  if (called === undefined) return null;
  const sink = publicSinkWrites(cfg, calledTool)[0];
  if (sink === undefined) return null;

  for (const resource of cfg.resources) {
    if (resource.trust !== "untrusted") continue;
    for (const reader of cfg.tools) {
      if (!reader.reads.includes(resource.id)) continue;
      return [resource.kind, reader.name, CONTEXT_LABEL, called.name, sink.kind];
    }
  }
  return null;
}
