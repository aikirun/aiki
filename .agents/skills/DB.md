# Database and Migrations

- Postgres is required for running server/examples end-to-end.
- Unit tests (`bun run test:unit`) are hermetic and do not require a database.
- Integration tests (`bun run test:integration`) require a database. Credentials should be in `.env.test` at the repo root (see [`.env.test.example`](https://github.com/aikirun/aiki/blob/main/.env.test.example)).
- Schema sources:
    - `sdk/server/src/infra/db/pg/schema.ts`
    - `sdk/iam/src/infra/db/pg/schema.ts`

Generate migrations:

```bash
bun run db:migrate:generate
# or for a single service
bun run --cwd sdk/server db:migrate:generate
```

Custom migration (hand-written SQL/data backfill):

```bash
bun run --cwd sdk/server db:migrate:generate:custom
```

Apply migrations locally (server app):

```bash
bun run --cwd app/server db:migrate:apply
```

When schema changes, commit generated migration SQL and `meta/` snapshot files together with schema edits.
