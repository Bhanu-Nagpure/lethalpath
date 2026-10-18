# @lethalpath/guard

The runtime half of LethalPath: an MCP stdio server that tracks what a session
has absorbed in-process and blocks the write that would launder it to a public
sink. Every decision is appended to a per-session FalkorDB audit graph
(`sessions_<id>`); the block decision itself is in-process. The poisoned
`git.push` is refused with the route in the error; the same push in a fresh
session is allowed. The arrangement is what makes it lethal, so the arrangement
is what the guard watches.

## How a decision is made

- `decideCall(cfg, policy, taint, tool)` is pure — same inputs, same verdict —
  and a string of decisions is driven by `Guard`, which serializes appends.
- Reads are always allowed; each read contributes its resource's labels
  (`untrusted`, `private`) to the session taint.
- A write is blocked when the session holds untrusted input *and* private
  data and the write reaches a public sink. The refusal is an MCP `isError`
  result that names the route, so the block explains itself.
- The policy file can deny tools outright; a policy deny wins over everything,
  including the taint route.

## The session log (`sessions_<id>` graph)

Every step lands in FalkorDB: `(:Session)-[:STEP]->(:Step)` with tool name,
decision, reason, timestamp, and a 16-hex sha256 of the canonical arguments —
**never the arguments themselves**. The audit test asserts that no argument
substring survives anywhere in the graph, and that a blocked step moves no
data (zero edges written).

## Commands

```bash
pnpm --filter @lethalpath/guard build     # pretest builds deps too
pnpm --filter @lethalpath/guard test      # 8 tests, incl. a real stdio end-to-end
pnpm --filter @lethalpath/guard demo      # the four-call transcript, over stdio
pnpm --filter @lethalpath/guard demo /path/policy.json   # verify the exit-1 path
```

## Not covered (yet)

- Concurrent `decide()` calls — the serialization queue exists and is not
  under test.
- The `onclose` graceful-shutdown path — tests and demos stop the child
  process with a signal, which is a different path.
