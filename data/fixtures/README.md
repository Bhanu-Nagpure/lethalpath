# Fixtures

Synthetic scan configs used by the CLI, the tests and the public evidence runs.
They contain fake repositories, fake paths and placeholder tokens only.

## Provenance

- `fs-git.json`, `clean.json`, `github-only.json`, `many-tools.json`,
  `mcp-demo.json` — written for this project.
- `incidents/*.json` — reconstructions from the published write-ups cited in
  [`docs/incident-replay.md`](../../docs/incident-replay.md). They encode
  capabilities only; no payloads, secrets or personal data.
- `mcp-public-readmes.json` — the GitHub, filesystem and git entries are copied
  from the official MCP server READMEs in
  [`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers)
  (MIT licence), retrieved 17 Oct 2026. The token is a placeholder and the
  filesystem paths are the READMEs' own examples. The file is included as a
  realistic public config, not as original work.
