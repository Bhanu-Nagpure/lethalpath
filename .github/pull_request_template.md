# Pull request

## What changed

<!-- One paragraph. Say WHAT changed, and for any number you add or change,
     name the file it came from beside it — the repo's number policy. -->

## Checklist

- [ ] `pnpm test` passes (53 tests: labeler 8, core 29, eval 8, guard 8) with FalkorDB up (`docker compose up -d`).
- [ ] `pnpm build` is clean — no new TypeScript errors.
- [ ] Every printed number names its source file beside it (a fixture, `packages/eval/results/*.json`, or `docs/live-evidence/`). A number without a source will be sent back.
- [ ] If behavior changed, `scripts/evidence.sh` was re-run and the new log under `docs/live-evidence/` is committed as produced (absolute local paths normalised to `<repo>`; no output trimmed).
- [ ] Claims on the site still match the repo: `node scripts/site-check.mjs`.
