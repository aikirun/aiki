<!--
Explain the change to a reviewer who has not seen the code: what was wrong or
missing, what this PR changes, and anything you deliberately left out. A table
or a short before/after example often says it faster than prose.

If this resolves an issue, link it: "Closes #123".
-->

## Test plan

<!-- How you checked that this works: commands you ran, scenarios you tried, tests you added. -->

## Checklist

- [ ] `bun run check` passes
- [ ] `bun run lint` passes
- [ ] `bun run test:unit` passes
- [ ] `bun run test:integration` passes, if this touches the database layer or a timer-queue adapter
- [ ] Schema changes include the generated migration (`bun run db:migrate:generate`)
- [ ] User-facing docs in `app/website/content/docs` are updated, if behavior users see has changed
