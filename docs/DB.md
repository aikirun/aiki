# Database and Migrations

- Postgres is required for running server/examples end-to-end.
- Tests do not require a database.
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

When schema changes, commit generated migration SQL and `meta/` snapshot files
together with schema edits.
