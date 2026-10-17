/**
 * `labelConfig` — mcp.json in, ScanConfig out.
 *
 * Every tool gets resources from the rules table with an explicit confidence;
 * every resource that two tools share is merged into one node (that shared
 * node is exactly how a leak route can cross servers). Tools no rule
 * recognizes are labelled `unknown tool output` at conf 0.2 AND listed in
 * `unlabelled`, so they are visible for review instead of silently treated
 * as harmless.
 *
 * The returned config is validated before it is returned: an invalid config
 * would land in Cypher strings downstream, so it must never leave here.
 */

import { validateScanConfig, type ResourceDecl, type ScanConfig, type ServerDecl, type ToolDecl } from "@lethalpath/schema";

import { parseClaudeMcp, safeId, uniqueId } from "./mcp.js";
import { matchRule, type ResourceShape, UNKNOWN_RULE_ID } from "./rules.js";

export interface LabelOptions {
  configId?: string;
  title?: string;
}

export interface LabelResult {
  config: ScanConfig;
  /** Full tool names (e.g. `weird.mystery_tool`) no rule could classify. */
  unlabelled: string[];
}

function mergeResource(resources: Map<string, ResourceDecl>, shape: ResourceShape): void {
  const existing = resources.get(shape.id);
  if (!existing) {
    resources.set(shape.id, {
      id: shape.id,
      kind: shape.kind,
      trust: shape.trust,
      sensitivity: shape.sensitivity,
      visibility: shape.visibility,
    });
    return;
  }
  // Same node, two tools: union the labels, first shape wins a conflict.
  existing.trust ??= shape.trust;
  existing.sensitivity ??= shape.sensitivity;
  existing.visibility ??= shape.visibility;
}

function deriveConfigId(servers: ServerDecl[]): string {
  if (servers.length === 0) return "mcp-empty";
  const head = servers
    .slice(0, 3)
    .map((s) => s.id)
    .join("-");
  const more = servers.length > 3 ? `-${servers.length}` : "";
  return safeId(`mcp-${head}${more}`);
}

export function labelConfig(input: unknown, opts: LabelOptions = {}): LabelResult {
  const parsed = parseClaudeMcp(input);

  // Our own ScanConfig: pass through, labels are already declared there.
  if (parsed.declared) {
    return { config: structuredClone(parsed.declared), unlabelled: [] };
  }

  const resources = new Map<string, ResourceDecl>();
  const tools: ToolDecl[] = [];
  const unlabelled: string[] = [];
  const usedToolNames = new Set<string>();
  const seenFullNames = new Set<string>();
  let expanded = 0;

  for (const server of parsed.servers) {
    if (!server.toolsListed && server.tools.length > 0) expanded += 1;
    for (const raw of server.tools) {
      const full = raw.startsWith(`${server.id}.`) ? raw : `${server.id}.${raw}`;
      if (seenFullNames.has(full)) continue;
      seenFullNames.add(full);

      const match = matchRule({ name: full, bare: raw, server: server.id, serverName: server.name });
      if (match.rule.id === UNKNOWN_RULE_ID) unlabelled.push(full);

      for (const shape of match.reads) mergeResource(resources, shape);
      for (const shape of match.writes) mergeResource(resources, shape);

      const reads = [...new Set(match.reads.map((s) => s.id))];
      const writes = [...new Set(match.writes.map((s) => s.id))];
      tools.push({
        name: uniqueId(usedToolNames, safeId(full)),
        server: server.id,
        reads,
        writes,
        labelSource: "rule",
        labelConf: match.rule.conf,
      });
    }
  }

  const servers: ServerDecl[] = parsed.servers.map((s) => ({ id: s.id, name: s.name, source: s.source }));
  const names = servers.map((s) => s.name);
  const title =
    opts.title ??
    (names.length === 0
      ? "MCP config (no servers)"
      : `MCP config · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`);
  const expansionNote = expanded > 0 ? ` ${expanded} server(s) declared no tools; their conventional tool sets were expanded from KNOWN_SERVER_TOOLS — verify with a real tools/list.` : "";

  const config: ScanConfig = {
    id: opts.configId !== undefined ? safeId(opts.configId) : deriveConfigId(servers),
    title,
    note: `${tools.length} tools labelled by rules; ${unlabelled.length} unlabelled (visible in the report).${expansionNote}`,
    servers,
    resources: [...resources.values()],
    tools,
  };

  const problems = validateScanConfig(config);
  if (problems.length > 0) {
    throw new Error(`labeler produced an invalid scan config:\n- ${problems.join("\n- ")}`);
  }
  return { config, unlabelled };
}

export { parseClaudeMcp, serverNames, stripSecrets, type McpServerEntry, type ParsedMcp } from "./mcp.js";
export { matchRule, RULES, UNKNOWN_RULE_ID, type ResourceShape, type Rule } from "./rules.js";
