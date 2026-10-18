# Related work

Research note, **17 Oct 2026**. Every fact below is from a primary source read on that date,
unless a cell says **unverified**. Repository counts and activity are a snapshot of that date,
not a ranking.

Two questions are asked of every tool:

1. **Path analysis through shared resources** — does it find *paths* across servers, including
   laundering through intermediate tools/resources (a folder, a repo, a channel), rather than
   flagging servers or components one at a time?
2. **Minimal fix set** — does it output *which permission(s) to revoke* so that the discovered
   paths close, rather than a finding list or generic advice?

Legend: **Yes** / **Partial** / **No** / **N/A** / **Unverified**.
Some project READMEs could not be retrieved by the scraping tool (its safety filter blocks pages
that contain MCP client-configuration instructions). Where that happened, facts come from the
same projects' docs pages, repo metadata, and search-index snippets, and cells we could not
confirm say so.

---

## 1. MCP security scanners and gateways

| Tool | What it does (one line) | Cross-server paths through shared resources / intermediate tools? | Minimal fix set (revoke-this output)? | Graph-based? | URL |
|---|---|---|---|---|---|
| **Snyk Agent Scan** — formerly **Invariant Labs `mcp-scan`** (same project; `invariantlabs-ai/mcp-scan` now redirects to `snyk/agent-scan`, ~3.1k★, active) | Discovers agents, MCP servers, and skills; flags prompt injection in tool descriptions, untrusted content, private data, destructive capabilities; v0.6 scores risk indicators 0–1000; analysis data is sent to the Snyk API (secrets redacted first). Cross-server check E002 exists but is "tool references another server's tool in its description" (tool shadowing), which is a description check, not a data-flow path. | **No** — its own docs say of toxic flows: *"most agents possess all three… therefore inherently vulnerable. For this reason, our analysis focuses on each component individually"* (per-leg findings W015–W020). | **No** — findings + scores; advice is generic ("disable the affected server until…"). | **No** | [github.com/snyk/agent-scan](https://github.com/snyk/agent-scan) · [risks.md](https://github.com/snyk/agent-scan/blob/main/docs/risks.md) · [issue-codes.md](https://github.com/snyk/agent-scan/blob/main/docs/issue-codes.md) · [launch post](https://invariantlabs.ai/blog/introducing-mcp-scan) |
| **MCP-Shield** (`riseandignite/mcp-shield`, 554★, inactive since Apr 2025) | Scans installed MCP servers for tool poisoning, exfiltration channels, cross-origin escalation (search-index snippet; README fetch blocked — specifics unverified). | **No** shown (per-server checks) | **No** | **No** | [github.com/riseandignite/mcp-shield](https://github.com/riseandignite/mcp-shield) |
| **mcptrustchecker** (`mcptrustchecker.com`, MIT) | Offline, deterministic scanner that grades ONE MCP server (A–F / 0–100, "Capability-Flow Trust Model"); builds a *cross-tool toxic-flow graph inside the server* and fires e.g. `MTC-FLOW-002 untrusted-input → sensitive-source → external-sink [critical] lethal trifecta co-reachable across tools`; corpus claim: 30,000+ servers scanned to calibrate. | **Partial** — within a single server (cross-tool co-reachability); no cross-server, resource-level paths. | **No** — grade + rule findings. | **Yes** — within-server toxic-flow graph. | [mcptrustchecker.com](https://mcptrustchecker.com) · [github.com/illia-haidar/mcptrustchecker](https://github.com/illia-haidar/mcptrustchecker) |
| **Docker MCP Gateway** (`docker/mcp-gateway`, ~1.6k★, active) | Runs catalog MCP servers as isolated containers behind one gateway; signature checks, call logging, secret and network controls, programmable interceptors (security middleware). | **No** — infrastructure isolation and policy, not path discovery. | **No** — controls are user-configured, not computed. | **No** | [github.com/docker/mcp-gateway](https://github.com/docker/mcp-gateway) · [docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/) · [Docker security blog](https://www.docker.com/blog/mcp-security-explained/) |
| **Trail of Bits `mcp-context-protector`** (226★) | Wrapper MCP server: trust-on-first-use pinning of tool descriptions/server instructions, LLM guardrail scanning of them for prompt injection, ANSI control-sequence sanitisation, human-in-the-loop controls; defends the "line jumping" class. | **No** — runtime protection of the context window. | **No** | **No** | [repo](https://github.com/trailofbits/mcp-context-protector) · [announcement](https://blog.trailofbits.com/2025/07/28/we-built-the-security-layer-mcp-always-needed/) |
| **Semgrep** (`semgrep/mcp`, 686★; plus MCP guide) | Code SAST; ships an MCP server so assistants can run Semgrep scans, and published "A Security Engineer's Guide to MCP" with a cheatsheet and a tool-shadowing demo. Its analysis target is *code*, not MCP composition; it is a baseline others benchmark against (MCP-BiFlow compares against Semgrep). | **No** | **No** — rules and guidance. | **No** | [guide](https://semgrep.dev/blog/2025/a-security-engineers-guide-to-mcp) · [semgrep/mcp](https://github.com/semgrep/mcp) |
| **Cisco `mcp-scanner`** (1,094★, active) | "Scan MCP servers for potential threats & security findings" (repo description). | **No** shown | **No** | **No** | [github.com/cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner) |

---

## 2. Data-flow / taint / "lethal trifecta" tooling

| Tool | What it does (one line) | Cross-server paths through shared resources / intermediate tools? | Minimal fix set (revoke-this output)? | Graph-based? | URL |
|---|---|---|---|---|---|
| **triflow** (`Lonkins/triflow`, Apache-2.0) | "Cross-server MCP toxic-flow (lethal-trifecta) analyzer + SKILL.md linter"; its public description says it complements per-tool scanners (mcp-scan/Snyk agent-scan) that "inspect individual tool descriptions". | **Partial** — classifies servers into trifecta legs and prints a representative chain (server-level; internals **unverified** — README fetch blocked). | **No** computed set. | **Unverified** | [github.com/Lonkins/triflow](https://github.com/Lonkins/triflow) |
| **Trilock** (`mcp-trilock` on PyPI, v0.2.0; `Poojan6216/trilock`) | "A drop-in MCP proxy that makes the lethal trifecta structurally impossible"; repo description adds that it "publishes the benchmark, and the attacks that beat it". Benchmark numbers **unverified** in this pass. | **No** — runtime session gating, not static path mapping. | **No** | **No** | [pypi.org/project/mcp-trilock](https://pypi.org/project/mcp-trilock/) · [repo](https://github.com/Poojan6216/trilock) |
| **Manifest linters/gates**: `fevziegeyurtsevenler/lethal-trifecta-lint` (Apache-2.0), `hyuga611/trifecta-gate` (MIT, created 14 Oct 2026), `j-dahl7/lethal-trifecta-lab` (MIT) | CI linters / gates that fail when a tool manifest (MCP, OpenAI, LangChain) holds all three legs; `lethal-trifecta-lab` is a tool-call policy engine enforcing the Rule of Two. (trifecta-gate repo description empty — details **unverified**.) | **No** — leg presence / counting. | **No** — a gate, not a cut. | **No** | [lint](https://github.com/fevziegeyurtsevenler/lethal-trifecta-lint) · [gate](https://github.com/hyuga611/trifecta-gate) · [lab](https://github.com/j-dahl7/lethal-trifecta-lab) |
| **MSCC** (`gensecaihq/mcpscc`, Apache-2.0) — *closest prior art we found* | Maps MCP servers, skills, and memory into graded cross-surface exposure paths (0–100 by approval gating, capability breadth, source trust, egress breadth); toxic-flow detection, drift/rug-pull detection, policy-as-code in CI; runs fully locally. | **Yes** — "Cross-server chains (source → sensitive → egress)" and a "cross-surface graph" where a poisoned skill/memory reaches a sensitive MCP server and an egress server. This is the closest existing thing to the path-analysis question. | **No** shown — it reports and ranks paths; enforcement is user-authored policy, not a computed minimal revocation set. | **Yes** — "cross-surface graph". | [github.com/gensecaihq/mcpscc](https://github.com/gensecaihq/mcpscc) |
| **AgentHound** (`Dolphinllc/agenthound`, 4★, dormant since Apr 2026) | "BloodHound for AI agents — visualize attack paths through MCP tool chains" (repo description). | **Yes** — path visualisation; modelling depth **unverified**. | **No** | **Yes** | [github.com/Dolphinllc/agenthound](https://github.com/Dolphinllc/agenthound) |
| **AgentSeal** (`getagentseal/agentseal`, 377★; agentseal.org) | Scans a machine for dangerous skills and MCP configs, prompt-injection testing, live MCP server audit; registry of "Security scores for 800+ MCP servers. 9 analyzers scan for prompt injection, toxic flows, and attack surface risks." Blog (org-published): 1,808 servers scanned, 66% with findings (company-reported). | **No** — per-server scores. | **No** | Unverified | [agentseal.org](https://agentseal.org/blog/mcp-server-security-findings) · [repo](https://github.com/getagentseal/agentseal) |
| **Promptfoo** | Red-teaming/guardrails platform with an MCP proxy; its blog post shows how to test an agent for the lethal trifecta with adversarial evals. | **No** — dynamic attack testing, not static graph analysis. | **No** | **No** | [blog](https://www.promptfoo.dev/blog/lethal-trifecta-testing/) |
| **CaMeL** (Google DeepMind; arXiv 2503.18813; `google-research/camel-prompt-injection`, 407★) | A protective system layer around the LLM in a custom interpreter: extracts control and data flow from the (trusted) query; capabilities prevent exfiltration of private data over unauthorized flows. AgentDojo: 77% of tasks with provable security vs 84% undefended. Research artifact; requires rewriting the agent into CaMeL's interpreter. | **N/A** — enforces flows by construction inside its interpreter; it does not scan an existing MCP config. | **No** — denies unauthorized flows per call; no revoke-set output. | **No** — capability/data-flow system. | [arXiv](https://arxiv.org/abs/2503.18813) · [code](https://github.com/google-research/camel-prompt-injection) |
| **Meta AI — "Agents Rule of Two"** (published 31 Oct 2025; covered by Simon Willison) | Design rule: until prompt-injection robustness is reliable, an agent session should satisfy **at most two** of {A untrusted input, B sensitive data/external systems, C state change/external comms}; if all three are needed, require supervision or a fresh session. | It is a principle, not a tool. | — | — | [Simon Willison's write-up](https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/) · [Meta AI post](https://ai.meta.com/blog/practical-ai-agent-security/) |
| **OpenAI** | Instruction Hierarchy (2024) and "Designing AI agents to resist prompt injection" (11 Mar 2026): constrain the impact of manipulation through system design; treats injection as evolving social engineering. Model/product-level. | **No** | **No** | **No** | [post](https://openai.com/index/designing-agents-to-resist-prompt-injection/) · [instruction hierarchy](https://openai.com/index/the-instruction-hierarchy/) |
| **Anthropic** | Constitutional Classifiers (Feb 2025) against universal jailbreaks; "Mitigating the risk of prompt injections in browser use" (24 Nov 2025): Claude Opus 4.5 at ~1% attack-success in a browser-use red-team (company-reported). Model/product-level. | **No** | **No** | **No** | [browser use](https://www.anthropic.com/research/prompt-injection-defenses) · [classifiers](https://www.anthropic.com/research/constitutional-classifiers) |

---

## 3. Academic work

| Work | What it is | Path analysis? | Minimal fix set? | Graph? | Link |
|---|---|---|---|---|---|
| **ToolLinkOS / Graph RAG-Tool Fusion** (arXiv 2502.07223, Lumer et al.) | Tool-*retrieval*: vector search + graph traversal over a tool-dependency graph. Introduces the ToolLinkOS dataset (573 fictional tools, 1,569 queries, dependency edges). **No security labels** (no trust/sensitivity/sink); not a security tool. | **No** — retrieval; no leak semantics. | **No** | **Yes** — tool dependency graph (we reuse it for fix weighting + eval). | [arXiv](https://arxiv.org/abs/2502.07223) · [repo](https://github.com/EliasLumer/Graph-RAG-Tool-Fusion-ToolLinkOS) |
| **Hou et al. — "Model Context Protocol (MCP): Landscape, Security Threats, and Future Research Directions"** (arXiv 2503.23278) | Systematic study: MCP lifecycle (4 phases/16 activities), threat taxonomy (16 scenarios, 4 attacker types), safeguards. The reference landscape paper. | **No** — taxonomy. | **No** | **No** | [arXiv](https://arxiv.org/abs/2503.23278) |
| **"Systematic Analysis of MCP Security"** (arXiv 2508.12538) | "First systematic classification and quantitative analysis of MCP-specific attack methods, identifying 31 distinct attack types" (abstract snippet). | **No** — taxonomy. | **No** | **No** | [arXiv](https://arxiv.org/abs/2508.12538) |
| **MCPHunt** (arXiv 2604.27819) | "First controlled benchmark that isolates non-adversarial, verbatim credential propagation across multi-server MCP trust boundaries"; canary-based taint tracking; 3,615 traces / 147 tasks; **policy-violating propagation 11.5–41.3%** across 5 models; prompt-level mitigation up to −97% but "prompt-level defenses alone may not suffice". | Measures propagation *pathways* empirically — it does not scan a config, enumerate paths, or propose a fix. | **No** | Not a config graph (trace-based measurement). | [arXiv](https://arxiv.org/abs/2604.27819) · [code](https://github.com/lihaonan0716/MCPHunt) |
| **MCP-BiFlow — "Unsafe by Flow"** (arXiv 2605.07836, Hou/Zhao/Wang) | Bidirectional static taint analysis of **MCP server source code** (protocol-aware entrypoint recovery, interprocedural propagation). 93.8% recall on 32 confirmed cases vs CodeQL, Semgrep, Snyk Code, MCPScan; 118 confirmed vulnerability paths in 87 servers across 15,452 repos. | Code-level data flow *inside servers* — not cross-server composition. | **No** — finds bugs. | Data-flow analysis over code (not a config graph). | [arXiv](https://arxiv.org/abs/2605.07836) |
| **mcp-sec-audit — "Auditing MCP Servers for Over-Privileged Tool Capabilities"** (arXiv 2603.21641) | Audits MCP servers for over-privileged capabilities: static pattern matching for Python servers + dynamic sandboxed fuzzing and monitoring (Docker, eBPF); rule-based mitigation recommendations. Closest verified "fuzzing MCP" work. | **No** | **No** — recommendations, not a minimal revocation set. | **No** | [arXiv](https://arxiv.org/abs/2603.21641) |
| **VIPER-MCP** (arXiv 2605.21392) and **"What Happens Locally, Leaks Globally"** (arXiv 2606.21338) | Detecting/exploiting taint-style vulnerabilities in MCP servers; detecting privacy-leakage risks in MCP servers. Server-internal analyses. | Server-internal, not composition. | **No** | — | [arXiv](https://arxiv.org/abs/2605.21392) · [arXiv](https://arxiv.org/abs/2606.21338) |
| **"agent capability graph"** | **Unverified** — no established work found under this name (web + arXiv searches, 17 Oct 2026). Nearest published constructs: CaMeL's capabilities; the ToolLinkOS dependency graph; MSCC's cross-surface graph. | — | — | — | — |

---

## Names we could not verify

- **AgentSandbox** — **unverified**: no artifact found under this name (Google/Bing, arXiv, GitHub
  incl. the `microsoft` org — 404). If it refers to a sandboxing runtime, the verified relatives
  are runtimes and containment frameworks (e.g. SideKernel, arXiv 2610.02456; Docker Sandboxes,
  docs.docker.com/ai/sandboxes/; "Containing the Autonomous Operator", arXiv 2610.02861).
- **Microsoft fuzzing MCP** — **unverified**: no first-party Microsoft artifact found with that
  description. Microsoft's adjacent verified work: **PyRIT** (AI red-teaming framework, 2024) and
  the **Windows MCP security** announcement (19 May 2025). Closest verified "fuzzing MCP":
  `mcp-sec-audit` (arXiv 2603.21641) and `mcpsec` (PyPI protocol fuzzer).
- Also seen, not examined in depth: **AgentShield** (`aiconnai/agentshield`), **mcp-scrutiny**
  (`bryand410`), **MCP-Scanner** (ACM paper, dl.acm.org/doi/10.1145/3786160.3788471; benchmarked as
  "MCPScan" in MCP-BiFlow), **tailscale/lethal-trifecta-mitigation-demo** (network-policy
  mitigation demo, not a scanner).

---

## How LethalPath differs

**What we are not first at, and who does it better or equal:**

- *Detecting the trifecta*: Snyk Agent Scan (`mcp-scan`), mcptrustchecker, triflow, Trilock and the
  manifest linters already do it. Snyk runs at ecosystem scale and is maintained; mcptrustchecker
  grades at single-server depth with source verification of published packages — its per-server
  precision can beat our inferred labels. The contribution is elsewhere.
- *Cross-surface path mapping*: **MSCC already charts graded source → sensitive → egress exposure
  paths across servers, skills, and memory**, with drift detection and CI policy — ahead of us on
  surfaces covered (skills, memory) and on maturity. AgentHound already visualises attack paths
  through MCP tool chains. Cross-surface path mapping is already established.
- *Runtime enforcement*: Trilock (proxy that makes the session trifecta impossible), Trail of Bits'
  `mcp-context-protector`, promptfoo's MCP proxy/guardrails, and Docker's gateway/interceptors
  enforce at runtime and can see argument-level data our static analysis only infers. Runtime
  blocking is not new.
- *Guarantees*: CaMeL gives provable non-exfiltration by construction — a stronger property than
  any static cut — at the cost of rewriting the agent into its interpreter. We do not match that.
- *Precision inside a server*: MCP-BiFlow statically traces real taint through server source;
  mcptrustchecker reads the shipped code. Our labels are inferred (a rules table plus tool-set
  expansions, regression-tested), which is a genuine accuracy risk they do not share.
- *The algorithm*: max-flow/min-cut is classical graph theory. We claim no novelty for it.
- MCPHunt studies the same phenomenon (cross-boundary propagation) as a benchmark, with numbers
  worth citing in the README.

**What we did not find in the tools above:**

1. **Resource-level, multi-hop leak paths across servers, including laundering hops through shared
   resources** (a folder, a repo, a channel) and with the agent's **Context as a first-class node**.
   MSCC's graded chains are the closest existing thing; the shared-resource/A→B→C resource graph
   with a context hub is what we could not find elsewhere.
2. **A computed minimal fix set** — weighted min-cut over the same graph that breaks every
   discovered path while keeping tasks working, emitted as a concrete config diff. No tool examined
   outputs "revoke *these* grants"; Snyk's and others' advice is generic, MSCC's enforcement is
   user-authored policy.
3. **Both, executed on the graph database itself** (FalkorDB 6.0.2, `GRAPH.RO_QUERY`-enforced reads,
   `algo.maxFlow` for the cut), so the path finder and the fix are the same queryable artifact.

---

## Prior art

- **Simon Willison** — "The lethal trifecta" (16 Jun 2025) and the GitHub MCP exploit coverage;
  the *Agents Rule of Two* write-up.
- **Invariant Labs → Snyk** — `mcp-scan` → Snyk Agent Scan; tool-poisoning research; the toxic-flows
  docs whose per-component framing our path analysis extends (W015–W020).
- **mcptrustchecker**, **MSCC**, **triflow**, **Trilock**, **AgentHound**, **AgentSeal**,
  **lethal-trifecta-lint**, **trifecta-gate**, **lethal-trifecta-lab** — the trifecta-tooling
  ecosystem.
- **Trail of Bits** (mcp-context-protector, line-jumping research), **Semgrep** (MCP guide),
  **Cisco** (`mcp-scanner`), **Docker** (MCP Gateway).
- **Meta AI** — "Agents Rule of Two" (31 Oct 2025); **OpenAI** — instruction hierarchy + agent
  injection-resistance design; **Anthropic** — browser-use injection defenses, constitutional
  classifiers.
- **Papers**: MCPHunt (2604.27819); MCP-BiFlow / Unsafe by Flow (2605.07836); mcp-sec-audit
  (2603.21641); VIPER-MCP (2605.21392); What-Happens-Locally-Leaks-Globally (2606.21338); Hou et
  al. MCP landscape (2503.23278); Systematic Analysis of MCP Security (2508.12538);
  ToolLinkOS / Graph RAG-Tool Fusion (2502.07223).
- **Promptfoo** — lethal-trifecta testing guide.

---

## Sources (all read 17 Oct 2026)

**Posts / blogs**
- simonwillison.net — [lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [GitHub MCP exploited](https://simonwillison.net/2025/May/26/github-mcp-exploited/), [new prompt-injection papers](https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/)
- [Meta AI — Practical AI agent security](https://ai.meta.com/blog/practical-ai-agent-security/)
- [Invariant Labs — Introducing MCP-Scan](https://invariantlabs.ai/blog/introducing-mcp-scan)
- [Trail of Bits — We built the security layer MCP always needed](https://blog.trailofbits.com/2025/07/28/we-built-the-security-layer-mcp-always-needed/)
- [Semgrep — A Security Engineer's Guide to MCP](https://semgrep.dev/blog/2025/a-security-engineers-guide-to-mcp)
- [Docker — MCP Security: Risks, Challenges, and How to Mitigate](https://www.docker.com/blog/mcp-security-explained/)
- [AgentSeal — We scanned 1,808 MCP servers](https://agentseal.org/blog/mcp-server-security-findings) (company-reported)
- [Promptfoo — Testing the lethal trifecta](https://www.promptfoo.dev/blog/lethal-trifecta-testing/)
- [OpenAI — Designing AI agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/); [Instruction hierarchy](https://openai.com/index/the-instruction-hierarchy/)
- [Anthropic — Prompt-injection defenses in browser use](https://www.anthropic.com/research/prompt-injection-defenses); [Constitutional classifiers](https://www.anthropic.com/research/constitutional-classifiers)

**Tools**
- [snyk/agent-scan](https://github.com/snyk/agent-scan) + [risks.md](https://github.com/snyk/agent-scan/blob/main/docs/risks.md) + [issue-codes.md](https://github.com/snyk/agent-scan/blob/main/docs/issue-codes.md) + [scanning.md](https://github.com/snyk/agent-scan/blob/main/docs/scanning.md)
- [riseandignite/mcp-shield](https://github.com/riseandignite/mcp-shield)
- [mcptrustchecker.com](https://mcptrustchecker.com) + [illia-haidar/mcptrustchecker](https://github.com/illia-haidar/mcptrustchecker)
- [docker/mcp-gateway](https://github.com/docker/mcp-gateway) + [Docker MCP Gateway docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/)
- [trailofbits/mcp-context-protector](https://github.com/trailofbits/mcp-context-protector)
- [semgrep/mcp](https://github.com/semgrep/mcp)
- [cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner)
- [Lonkins/triflow](https://github.com/Lonkins/triflow)
- [pypi.org/project/mcp-trilock](https://pypi.org/project/mcp-trilock/) + [Poojan6216/trilock](https://github.com/Poojan6216/trilock)
- [fevziegeyurtsevenler/lethal-trifecta-lint](https://github.com/fevziegeyurtsevenler/lethal-trifecta-lint) + [hyuga611/trifecta-gate](https://github.com/hyuga611/trifecta-gate) + [j-dahl7/lethal-trifecta-lab](https://github.com/j-dahl7/lethal-trifecta-lab)
- [gensecaihq/mcpscc](https://github.com/gensecaihq/mcpscc)
- [Dolphinllc/agenthound](https://github.com/Dolphinllc/agenthound)
- [getagentseal/agentseal](https://github.com/getagentseal/agentseal) + [getagentseal/awesome-mcp-security](https://github.com/getagentseal/awesome-mcp-security)
- [google-research/camel-prompt-injection](https://github.com/google-research/camel-prompt-injection)
- [tailscale/lethal-trifecta-mitigation-demo](https://github.com/tailscale/lethal-trifecta-mitigation-demo)
- [aiconnai/agentshield](https://github.com/aiconnai/agentshield) · [bryand410/mcp-scrutiny](https://github.com/bryand410/mcp-scrutiny) · [mcpsec (PyPI)](https://pypi.org/project/mcpsec/) (seen, not examined in depth)

**Papers**
- [CaMeL — Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) (Google DeepMind)
- [Graph RAG-Tool Fusion / ToolLinkOS](https://arxiv.org/abs/2502.07223) + [repo](https://github.com/EliasLumer/Graph-RAG-Tool-Fusion-ToolLinkOS)
- [MCP: Landscape, Security Threats, and Future Research Directions](https://arxiv.org/abs/2503.23278) (Hou et al.)
- [Systematic Analysis of MCP Security](https://arxiv.org/abs/2508.12538)
- [MCPHunt — Cross-Boundary Data Propagation in Multi-Server MCP Agents](https://arxiv.org/abs/2604.27819) + [code](https://github.com/lihaonan0716/MCPHunt)
- [Unsafe by Flow — MCP-BiFlow](https://arxiv.org/abs/2605.07836) (Hou et al.)
- [Auditing MCP Servers for Over-Privileged Tool Capabilities (mcp-sec-audit)](https://arxiv.org/abs/2603.21641)
- [VIPER-MCP](https://arxiv.org/abs/2605.21392) · [What Happens Locally, Leaks Globally](https://arxiv.org/abs/2606.21338)
- [Detecting Security Risks in MCP Systems (MCP-Scanner)](https://dl.acm.org/doi/10.1145/3786160.3788471)
