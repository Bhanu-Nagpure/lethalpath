# @lethalpath/labeler

Turns an `mcp.json` (or any draft config) into a validated scan config —
servers, resources, tools, and a confidence for every inference. No database
needed here; the output feeds `ingest` in `packages/core`, which builds the
FalkorDB graph the scan runs on.

## How it decides

- A 35-row rules table (`src/rules.ts`), first match wins, case-insensitive on
  both the namespaced name (`github.get_issue`) and the bare name
  (`get_issue`). Rows can require a server match (`serverAnyOf`) and are
  skipped when a `veto` substring is present.
- Tool-set expansions for 11 conventional servers (`KNOWN_SERVER_TOOLS`) fill
  in a server's tools when the capture lists servers but not tools.
- Anything unmatched lands in `unlabelled` with the fallback resource
  (`unknown tool output`) — surfaced for a human, never silently dropped.
- Secrets: every `env` value is dropped wholesale, and tokens inside URL query
  strings are redacted, before anything leaves the machine.

## Commands

```bash
pnpm --filter @lethalpath/labeler build
pnpm --filter @lethalpath/labeler test    # the 50-row gold set: 50/50
```

## Known weaknesses

The gold set (`gold/labels.csv`, 50 hand-written rows) is self-authored
alongside the rules: it proves internal consistency and catches regressions,
not external ground truth. The rules we trust least, in public:

- `github.issue.write` — `add_comment`/`update_file` are bare substrings, so a
  docs tool can get an issue-write label. The sink assumption is right, the
  kind words are not.
- `git.push` / `createPR` — assumes the remote is public (`visibility:
  public`). A push to a private remote is mislabelled as a sink.
- `db.hint` — a bare `execute`/`exec` genuinely cannot say which direction the
  data moves; it is labelled as read *and* write, conf 0.4.
- `tracker.read` / `tracker.write` — direction comes from veto-verb lists; a
  tool named `jira_sync` reads as a read.
- Three of the 50 gold rows pass by expecting the fallback resource. They are
  misses, counted as agreements.
- Scope is unknowable from a name: rules cannot say *which* folder, bucket or
  channel a tool points at, nor whether a remote is actually world-readable.

Also stated plainly: a real `mcp.json` usually lists servers, not tools. The
expansion table covers 11 conventional servers and says so — prefer a real
`tools/list` capture when you have one.
