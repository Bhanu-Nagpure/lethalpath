# How these Browser captures were taken

**Date:** 2026-10-17 · **FalkorDB:** v6.0.2 (Rust engine) at `localhost:6379` ·
**UI:** FalkorDB Browser at `http://localhost:3000`

Both files committed here came from that instance, read-only: every query was
`GRAPH.RO_QUERY`, no graph was modified, and both `scan_*` graphs already
existed before the session.

| File | What it shows |
|---|---|
| `browser-scan-fs-git.png` | `scan_fs-git`: 11 nodes, 9 edges — the `Server` / `Resource` / `Tool` / `Context` / `Meta` labels and the `FLOWS` + `HOSTS` relationships, in full Browser chrome: graph tab, Graph Info panel (NODES 11 · EDGES 9), the query editor, layout control, and the live stats bar. |
| `browser-scan-mcp.png` | `scan_mcp-github-filesystem-git`, the demo mcp config after `scan --mcp`: 49 nodes, 120 edges. The stats bar reads `Nodes: 48 | Edges: 86` — that is the Browser's default `LIMIT 100` view of the same graph, not a smaller graph. |

## The steps, for anyone re-shooting these

1. `docker compose up -d`, then open `http://localhost:3000` and log in with
   the prefilled defaults (`localhost` / `6379`, no auth).
2. Dismiss the onboarding tour ("Skip Tutorial") — it centres over the canvas.
3. Open the graph picker (the button shows "Select Graph" until a graph is
   chosen), search for `scan_fs-git` (or `scan_mcp-github-filesystem-git`), and
   pick it. Selecting a graph auto-runs the Browser's default query —
   `MATCH (n) OPTIONAL MATCH (n)-[e]-(m) RETURN * LIMIT 100`. Keeping that
   default matters on `scan_fs-git`: it renders the isolated `:Meta` node, so
   all 11 nodes are visible where a directed `MATCH (n)-[r]->(m)` would show 10.
4. Wait for the force layout to settle, then "Fit graph to screen" followed by
   "Zoom in" twice — fit alone leaves dead space, because it centres against
   the full window width, ignoring the sidebar overlay.
5. Park the pointer on empty canvas (no hover tooltips in frame) and capture.
   The instance counters in the header ("Graphs: …", "Memory: …") are live
   stats and differ between runs; that is expected.

The dark theme (sidebar "Toggle theme") is what the committed captures use —
it holds up on both GitHub themes for dark-background pages.
