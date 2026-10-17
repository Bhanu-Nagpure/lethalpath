# Four published incidents, replayed

Four real, publicly documented agent/tool exfiltration incidents, encoded as
scannable fixtures under `data/fixtures/incidents/`. Each fixture is a
reconstruction from the published write-up — capability labels only, no
payloads, no secrets — and carries its own provenance block (source URL,
publication date, method). `scan` rediscovers the published chain; `fix`
computes the revocation and re-runs the leak query without it. Where the
vendors (or the researchers) shipped a fix by hand, the section says exactly
which capability that fix scopes and whether the computed cut matches.

Number policy: every number below is from the cited write-up or from the
command output pasted next to it. All commands were run from a clone against
FalkorDB 6.0.2.

| fixture | routes found | computed cut (revoke) | tasks kept |
|---|---|---|---|
| `github-mcp-heist.json` | 1 | `github.create_pull_request` | 2 of 3 |
| `supabase-leak.json` | 2 | `supabase.execute_sql` | 0 of 1 |
| `whatsapp-mcp-exfil.json` | 1 | `whatsapp.send_message` | 2 of 3 |
| `postmark-registry-bcc.json` | 1 | `postmark.send_email` | 1 of 2 |

Postmark is a different kind of incident: a malicious package, not a prompt
injection. LethalPath does not detect malicious packages; the fixture only
shows that removing the package's grant closes the route, which is the same
fix as removing the package. The site marks it out of scope.

---

## 1 · GitHub MCP heist — 2025-05-26

**What happened.** Invariant Labs showed that a malicious issue in a public
repository can hijack the official GitHub MCP server: the agent reads the
issue, is steered into pulling private-repository data into context, and
publishes it in a pull request on the same public repo (the demo leaked
project details, relocation plans and salary into `ukend0464/pacman` PR #2).
Source: [invariantlabs.ai/blog/mcp-github-vulnerability](https://invariantlabs.ai/blog/mcp-github-vulnerability),
2025-05-26. Docker's
[re-telling](https://www.docker.com/blog/mcp-horror-stories-github-prompt-injection)
(2025-08-14) documents the tool-call sequence and ships the hand fix: a
`cross-repo-blocker.sh` interceptor — "one repository per session".

**Modeled.** `data/fixtures/incidents/github-mcp-heist.json` — one server
(`github`, one PAT over public and private repos). Injection leg: public issue
→ `github.list_issues` → context. Leak leg: private repositories →
`github.get_file_contents` → context → `github.create_pull_request` → public
PR.

**Replay.**

```
$ node packages/cli/dist/index.js scan data/fixtures/incidents/github-mcp-heist.json
LethalPath  ·  powered by FalkorDB 6.0.2

config    github-mcp-heist · GitHub MCP heist — a public issue steers one broad PAT through private repos and back out through a public PR
graph     scan_github-mcp-heist · 9 nodes · 9 edges · ready
guard     GRAPH.RO_QUERY · LIMIT 100 · 3 s timeout · write keywords refused
engine    leak two anchored segments through the tainted context · fix CALL algo.maxFlow + residual min-cut

LEAK PATHS
  1  4 hops  private repositories → github.get_file_contents → context → github.create_pull_request → pull request in a public repo
     injection  github issue in a public repo → github.list_issues → context
     in         private repositories · every repo the PAT can reach (the demo's private projects)
     out        pull request in a public repo · github.com/ukend0464/pacman/pull/2

1 route found — every one of them is a permission you granted.
  next  lethalpath fix
```

```
$ node packages/cli/dist/index.js fix data/fixtures/incidents/github-mcp-heist.json
LethalPath  ·  powered by FalkorDB 6.0.2

FIX  ·  CALL algo.maxFlow on FalkorDB

max-flow   2
cut        write side · github.create_pull_request → pull request in a public repo
revoke     github.create_pull_request
verified   0 of 1 routes remain (leak query re-run without github.create_pull_request)
tasks      2 of 3 keep working
           loses: open a pull request for an approved change

cost = 1 + declared tasks that use the grant; the max-flow value proves
this cut is minimal. The verification re-runs the same query, not a promise.
```

**The cut.** `github.create_pull_request` (write side, max-flow 2). The route
is a single chain, so revoking either end closes it; both edges cost the same
(1 + one declared task) and the max-flow tie-break chose the write side.

**Correspondence.** Differs from the shipped mitigation in which edge it cuts.
Docker's script blocks the cross-repo read — its own test transcript blocks
`get_file_contents` on the second repo ("Blocked attempt: testuser/private-repo"),
and Invariant's recommendation is the same scoping ("limit agent access to
only the repositories it needs"). The computed cut revokes the publish
instead. Docker's one-repo-per-session rule corresponds to the read-side cut —
revoke `github.get_file_contents` — which closes the same single route; the
documented write-side tie-break is why the tool picked the other end. Either
way the fix is one edge of a one-route graph.

**Limit.** The write-ups name the capabilities (`list_issues`,
`get_file_contents`, `create_pull_request`) and the demo repositories; the
payload and full chat trace are not reproduced.

**Proves.** A fully trusted server on one over-broad token is enough, and the
fix every vendor shipped by hand is one computable edge of the printed route.

---

## 2 · Supabase MCP leaks the database — 2025-07-08

**What happened.** General Analysis demonstrated a support-ticket prompt
injection against Cursor's Supabase MCP connection on a fresh project with
dummy data: the injected ticket steered the agent (running SQL as
`service_role`, which bypasses RLS) into reading the `integration_tokens`
table and inserting the contents as a new reply in the same ticket thread the
customer was watching. Source:
[generalanalysis.com/blog/supabase-mcp-blog](https://generalanalysis.com/blog/supabase-mcp-blog),
8 Jul 2025. Supabase's documented mitigations: `read_only=true`, `project_ref`
project scoping, tool-group `features`; General Analysis: "Read-only SQL
prevents the database write used to return secrets through the ticket in this
demonstration."

**Modeled.** `data/fixtures/incidents/supabase-leak.json` — one server
(`supabase`, one `execute_sql` capability under `service_role`). Injection
leg: customer-visible ticket thread → `supabase.execute_sql` → context. Leak
leg: `integration_tokens` → `supabase.execute_sql` → context →
`supabase.execute_sql` → ticket thread. One grant supplies all three legs.

**Replay.**

```
$ node packages/cli/dist/index.js scan data/fixtures/incidents/supabase-leak.json
LethalPath  ·  powered by FalkorDB 6.0.2

config    supabase-leak · Supabase MCP demo — a support ticket steers Cursor into reading integration_tokens and posting them back into the thread
graph     scan_supabase-leak · 6 nodes · 6 edges · ready
guard     GRAPH.RO_QUERY · LIMIT 100 · 3 s timeout · write keywords refused
engine    leak two anchored segments through the tainted context · fix CALL algo.maxFlow + residual min-cut

LEAK PATHS
  1  4 hops  integration_tokens table → supabase.execute_sql → context → supabase.execute_sql → support ticket thread (customer-visible)
     injection  support ticket thread (customer-visible) → supabase.execute_sql → context
     in         integration_tokens table · reachable only under service_role in the demo; dummy token rows
     out        support ticket thread (customer-visible) · the thread the customer opened; the leaked rows appeared as a new reply in it

  2  6 hops  integration_tokens table → supabase.execute_sql → support ticket thread (customer-visible) → supabase.execute_sql → context → supabase.execute_sql → support ticket thread (customer-visible)
     injection  support ticket thread (customer-visible) → supabase.execute_sql → context
     in         integration_tokens table · reachable only under service_role in the demo; dummy token rows
     out        support ticket thread (customer-visible) · the thread the customer opened; the leaked rows appeared as a new reply in it

2 routes found — every one of them is a permission you granted.
  next  lethalpath fix
```

```
$ node packages/cli/dist/index.js fix data/fixtures/incidents/supabase-leak.json
LethalPath  ·  powered by FalkorDB 6.0.2

FIX  ·  CALL algo.maxFlow on FalkorDB

max-flow   2
cut        write side · supabase.execute_sql → support ticket thread (customer-visible)
revoke     supabase.execute_sql
verified   0 of 2 routes remain (leak query re-run without supabase.execute_sql)
tasks      0 of 1 keep working
           loses: review the latest open support ticket

cost = 1 + declared tasks that use the grant; the max-flow value proves
this cut is minimal. The verification re-runs the same query, not a promise.
```

**The cut.** `supabase.execute_sql` (write side into the ticket thread,
max-flow 2). Route 1 is the published chain; route 2 is a walk that re-enters
the thread on the way — both exist because the same `execute_sql` grant both
reads and writes, and both close with one revocation. Because the server is
modeled as one SQL capability, the revocation covers its read side too — the
`tasks 0 of 1` line says so out loud.

**Correspondence.** Same capability the vendor scoped, coarser granularity.
The computed cut selects the write path into the ticket thread — exactly the
edge `read_only=true` removes. The vendor's fix scopes *inside* the tool (SQL
runs as a read-only Postgres user, so reads survive and the task keeps
working); the fixture revokes the whole `execute_sql` grant, because that is
the capability the configuration actually holds.

**Limit.** The demo was a fresh project with dummy data, and the two-route
count is the model's walk enumeration — the write-up reports one chain, not a
count. General Analysis's mitigation section was reviewed against current
Supabase docs (Sept 2026) but not rerun; this replay models the July 2025
setup.

**Proves.** One server can supply all three legs, and the vendor's manual
mitigation is the same edge the graph computes — with a receipt.

---

## 3 · WhatsApp MCP exfiltration — 2025-04-07

**What happened.** Invariant Labs demonstrated a sleeper MCP server: it
advertises `get_fact_of_the_day` innocuously, then swaps in a poisoned tool
description that reprograms the trusted `whatsapp-mcp`'s `send_message` —
recipient changed to the attacker's number, the user's chat history appended
to the message body. The malicious server never has to be called; exfil happens
through WhatsApp itself. Source:
[invariantlabs.ai/blog/whatsapp-mcp-exploited](https://invariantlabs.ai/blog/whatsapp-mcp-exploited),
2025-04-07 (page header; "Update Apr 9" adds the injected-message experiment).
The write-up names the `send_message` call as the critical one and ships no
vendor fix — its recommendation is caution about untrusted MCP servers.

**Modeled.** `data/fixtures/incidents/whatsapp-mcp-exfil.json` — two servers:
the trusted `whatsapp` server and the attacker's `fotd` sleeper. Injection
leg: poisoned tool description → `fotd.get_fact_of_the_day` → context. Leak
leg: WhatsApp chat history → `whatsapp.list_chats` → context →
`whatsapp.send_message` → message to the attacker's number.

**Replay.**

```
$ node packages/cli/dist/index.js scan data/fixtures/incidents/whatsapp-mcp-exfil.json
LethalPath  ·  powered by FalkorDB 6.0.2

config    whatsapp-mcp-exfil · WhatsApp MCP exfiltration — a sleeper tool description rewires send_message to the attacker's number
graph     scan_whatsapp-mcp-exfil · 10 nodes · 9 edges · ready
guard     GRAPH.RO_QUERY · LIMIT 100 · 3 s timeout · write keywords refused
engine    leak two anchored segments through the tainted context · fix CALL algo.maxFlow + residual min-cut

LEAK PATHS
  1  4 hops  WhatsApp chat history → whatsapp.list_chats → context → whatsapp.send_message → WhatsApp message delivered to the attacker's number
     injection  tool description from an attacker-controlled MCP server → fotd.get_fact_of_the_day → context
     in         WhatsApp chat history · the user's chats and recent messages
     out        WhatsApp message delivered to the attacker's number · recipient rewritten at send time; no real numbers

1 route found — every one of them is a permission you granted.
  next  lethalpath fix
```

```
$ node packages/cli/dist/index.js fix data/fixtures/incidents/whatsapp-mcp-exfil.json
LethalPath  ·  powered by FalkorDB 6.0.2

FIX  ·  CALL algo.maxFlow on FalkorDB

max-flow   2
cut        write side · whatsapp.send_message → WhatsApp message delivered to the attacker's number
revoke     whatsapp.send_message
verified   0 of 1 routes remain (leak query re-run without whatsapp.send_message)
tasks      2 of 3 keep working
           loses: send messages on request

cost = 1 + declared tasks that use the grant; the max-flow value proves
this cut is minimal. The verification re-runs the same query, not a promise.
```

**The cut.** `whatsapp.send_message` (write side, max-flow 2). The poisoned
description can still reach context after the cut; nothing in the model can
carry it out.

**Correspondence.** No shipped fix exists to compare against — the write-up
recommends not connecting untrusted servers. Its own trace singles out the
`send_message` call as the critical tool call; the computed cut revokes
exactly that grant, the exfil channel, while the injection leg stays visible
in the graph as the route's first segment.

**Limit.** The page header dates the post 2025-04-07 ("Update Apr 9" extends
it); a secondary timeline lists 2025-04-25 — this replay uses the page's own
date. This is Experiment 1 (the sleeper server); no phone numbers or payloads
are encoded.

**Proves.** Composition is the risk: one poisoned description plus one
legitimate send capability form a single route, and the cut removes the
channel without the poison ever needing to be detected.

---

## 4 · Postmark npm impersonation — 2025-09-25

**What happened.** A malicious npm package impersonating the official
`postmark-mcp` server shipped clean through 1.0.15; the 1.0.16 release added a
line that BCC'd every outgoing email to an address on the attacker's domain.
The package worked correctly — mail was delivered as expected — for about a
week and ~1,500 downloads; exposed content per the write-up: password resets,
2FA codes, financial information, customer details. Published fix: "remove it
immediately and rotate any potentially exposed credentials". Source:
[bleepingcomputer.com](https://www.bleepingcomputer.com/news/security/unofficial-postmark-mcp-npm-silently-stole-users-emails/),
2025-09-25 (on Koi Security research).

**Modeled.** `data/fixtures/incidents/postmark-registry-bcc.json` — the
impersonating `postmark` package plus the agent's `mail` side (declared: the
write-up names only the sending capability). Injection leg: inbound customer
email → `mail.read_inbox` → context. Leak leg: inbound email →
`mail.read_inbox` → context → `postmark.send_email` → silent BCC copy.
Delivery itself is modeled as not-a-sink — the leak is the hidden copy.

**Replay.**

```
$ node packages/cli/dist/index.js scan data/fixtures/incidents/postmark-registry-bcc.json
LethalPath  ·  powered by FalkorDB 6.0.2

config    postmark-registry-bcc · Postmark npm impersonation — every email the agent sends is silently BCC'd to the attacker
graph     scan_postmark-registry-bcc · 9 nodes · 7 edges · ready
guard     GRAPH.RO_QUERY · LIMIT 100 · 3 s timeout · write keywords refused
engine    leak two anchored segments through the tainted context · fix CALL algo.maxFlow + residual min-cut

LEAK PATHS
  1  4 hops  inbound customer email → mail.read_inbox → context → postmark.send_email → silent BCC copy to the attacker
     injection  inbound customer email → mail.read_inbox → context
     in         inbound customer email · mail the agent is asked to handle
     out        silent BCC copy to the attacker · every message sent through the package

1 route found — every one of them is a permission you granted.
  next  lethalpath fix
```

```
$ node packages/cli/dist/index.js fix data/fixtures/incidents/postmark-registry-bcc.json
LethalPath  ·  powered by FalkorDB 6.0.2

FIX  ·  CALL algo.maxFlow on FalkorDB

max-flow   2
cut        write side · postmark.send_email → silent BCC copy to the attacker
revoke     postmark.send_email
verified   0 of 1 routes remain (leak query re-run without postmark.send_email)
tasks      1 of 2 keep working
           loses: send customer notifications and replies

cost = 1 + declared tasks that use the grant; the max-flow value proves
this cut is minimal. The verification re-runs the same query, not a promise.
```

**The cut.** `postmark.send_email` (write side, max-flow 2).

**Correspondence.** Same capability the published advice removes. The hand fix
is "remove the package"; the computed cut revokes exactly that package's
grant, and the receipt shows the BCC route dies with it. Nothing else in the
arrangement changes.

**Limit.** The write-up documents the package and the BCC, not the agent
deployment around it; the inbox read is a declared reconstruction so the route
has a source — the exposed content classes are the write-up's own.

**Proves.** A tool that works perfectly is still a route to somewhere you
cannot see — there is no payload to detect, and the structured fix is revoking
the grant.

---

## Reproduce it

From a clone, against the local FalkorDB 6.0.2:

```
node packages/cli/dist/index.js scan data/fixtures/incidents/github-mcp-heist.json
node packages/cli/dist/index.js fix  data/fixtures/incidents/github-mcp-heist.json

node packages/cli/dist/index.js scan data/fixtures/incidents/supabase-leak.json
node packages/cli/dist/index.js fix  data/fixtures/incidents/supabase-leak.json

node packages/cli/dist/index.js scan data/fixtures/incidents/whatsapp-mcp-exfil.json
node packages/cli/dist/index.js fix  data/fixtures/incidents/whatsapp-mcp-exfil.json

node packages/cli/dist/index.js scan data/fixtures/incidents/postmark-registry-bcc.json
node packages/cli/dist/index.js fix  data/fixtures/incidents/postmark-registry-bcc.json
```

Reconstructions, not reproductions. Each fixture cites its source URL and
publication date in its `provenance` block; tool and resource names are
capability labels, never payloads; where the public record is thinner than the
model needs, the fixture's `note` and the Limit line above say so.
