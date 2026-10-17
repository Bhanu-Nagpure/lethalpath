# Security policy

## Reporting a vulnerability

Report privately first: use GitHub's private vulnerability reporting on this
repository (Security tab → Report a vulnerability) once it is public. A fix
ships before anything is said in the open. We aim to acknowledge within
48 hours; for a hackathon build, that is a promise, not an SLA.

## What this project stores

LethalPath reads MCP configs and never transmits them. The guard's session
graph stores tool names, decisions and a 16-hex sha256 of the canonical
arguments — never the arguments themselves, never file contents, never
credentials. If you find a path that stores more than that, it is a bug and
we want it.
