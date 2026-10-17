# How these screenshots were taken

**Date:** 2026-10-17 · **Machine:** local · **FalkorDB:** v6.0.2 (Rust engine) at `localhost:6379` · **Browser UI:** `http://localhost:3000` (FalkorDB Browser SPA)

## Deliverables (1600×1000, DSF=1)

| File | What it shows |
|---|---|
| `browser-scan-fs-git.png` | **Required shot.** `scan_fs-git` graph, light theme. 11 nodes / 9 edges (`Server`, `Resource`, `Tool`, `Context`, `Meta` labels; `FLOWS`, `HOSTS` relationships). Full UI chrome: tab `scan_fs-git`, left "Graph Info" panel (LABELS/RELATIONSHIPS legend, NODES 11, EDGES 9, MEMORY <1MB), query editor showing `MATCH (n) OPTIONAL MATCH (n)-[e]-(m) RETURN * LIMIT 100` (the Browser's auto-run default when you select a graph), bottom toolbar with layout control (Force) and stats `Nodes: 11 | Edges: 9 | RT: …`. |
| `browser-scan-fs-git-dark.png` | Same state, dark theme (looks best on GitHub dark backgrounds). |
| `browser-scan-mcp.png` | Optional dense shot, **dark**: `scan_mcp-github-filesystem-git` (49 nodes / 120 edges in the graph; the default query with `LIMIT 100` returns 48 nodes / 86 edges — matches the stats bar in the shot). |
| `browser-scan-mcp-light.png` | Same dense shot, light theme. |

No dev console was opened in any shot; no file in `/home/bhd/projects_2/Graph_Hacks` was modified (read-only usage). Both graphs already existed; the `lethalpath` CLI scan was **not** re-run. All graph reads used `GRAPH.RO_QUERY` via ioredis — nothing was written to FalkorDB.

## Exact steps

1. Naive attempt (only renders the connect screen — kept at `debug/browser-first.png`):
   ```
   /usr/bin/google-chrome --headless=new --no-sandbox --disable-gpu \
     --window-size=1600,1000 --virtual-time-budget=25000 \
     --screenshot=/tmp/opencode/shots/browser-first.png http://localhost:3000
   ```
   The SPA renders a login form (Host `localhost`, Port `6379`, Username/Password `Default`, TLS off) but of course never logs in by itself.

2. Playwright automation (the real path). Setup:
   ```
   cd /tmp/opencode/shots
   npm init -y && npm i playwright-core ioredis
   ```
   Launched with the cached browser binary:
   `executablePath = ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
   args `--no-sandbox --disable-gpu --force-color-profile=srgb`, viewport **1600×1000**.

3. Flow captured by the script (`debug/final4.js`, copies of all iterations kept in `debug/`):
   1. `goto http://localhost:3000` → click `#submit-button` ("Log in", defaults are pre-filled) → lands on `/graph`.
   2. Click **"Skip Tutorial"** (a 56-step onboarding tour pops up on first visit; it is centred over the canvas and must be dismissed, otherwise it appears in shots; it reappears on each fresh session).
   3. Open the graph picker (**"Select Graph"** button, top-left; after a graph is selected the button shows the graph's name instead) → a dropdown opens with a `Search for a Graph` input and a paged list (326 graphs on this instance) → type `scan_fs-git` → click the result.
   4. Selecting the graph **auto-runs** the Browser's default query:
      `MATCH (n) OPTIONAL MATCH (n)-[e]-(m) RETURN * LIMIT 100`. It renders all 11 nodes / 9 edges, including the isolated `:Meta` node that a directed `MATCH (n)-[r]->(m)` would drop (that one returns only 10 nodes / 9 edges), so the default query was kept for the README shot.
      **No typing into the editor was needed** — earlier attempts to type a custom query into the Monaco editor dropped characters (React re-render racing `keyboard.type`); if a custom query is ever needed, set `window.monaco.editor.getModels()[0].setValue(q)` instead (`window.monaco` is exposed).
   5. Wait ~9 s for the Force layout to settle → click **"Fit graph to screen"** → click **"Zoom in" twice** (fit alone leaves the graph small with dead space because it centres against the full window width, ignoring the sidebar overlay).
   6. Park the mouse on empty canvas and wait ~1.5 s (avoids hover tooltips/glow and the "Zoom in" tooltip ghost).
   7. Screenshot. Theme switched via the sidebar "Toggle theme" button (cycles system → dark → light) and re-shot per theme.

## Flaky bits / caveats

- **Tutorial overlay** on every fresh session — script always clicks "Skip Tutorial".
- **Monaco typing drops characters** under speed; avoid typing, use the default auto-run query or the `window.monaco` API.
- **"Fit graph to screen" does not visually fill the canvas** — it appears to fit against the full window width (canvas sits under the overlaid left panel), so `fit + zoom ×2` is the recipe used. A manual pan can re-centre; panning the graph too far up slides the top node (`Git MCP`) under the query bar — an attempt with a 45 px nudge was rejected for that reason (kept in `debug/v2-fsg-*.png`).
- After a graph is selected, the picker button no longer says "Select Graph" (it shows the current graph name); the script handles both states when switching graphs.
- The two small bottom nodes of `scan_fs-git` (the `:Meta` node and one `:Tool` node) sit slightly over the bottom stats strip at zoom ×2 — cosmetic, everything remains visible; no better composition was found within the timebox.
- Header counters ("Graphs: 324", "Memory: …") change between runs — harmless, they're live stats of the instance.
- Graph was *not* modified: only `GRAPH.RO_QUERY` reads were performed. `GRAPH.LIST` showed 326 graphs; both `scan_*` graphs untouched.

## Fallbacks kept (in `debug/`)

- `bak-fsg-fit-zoom2-{light,dark}.png` — the current fs-git shots (same as deliverables).
- `bak-mcp-fit-dark.png`, `bak-mcp-zoom1-dark.png` — alternative dense-graph framings.
- `dbg-after-run.png`, `dbg2-query-set.png` — earlier session states (auto-run default query visible).
- `browser-first.png` — the raw headless-Chrome login screen (proof the SPA needs a session).
