# Database and Migrations

- Postgres is required for running server/examples end-to-end.
- Unit tests (`bun run test:unit`) are hermetic and do not require a database.
- Integration tests (`bun run test:integration`) require a database. Credentials should be in `.env.test` at the repo root (see [`.env.test.example`](https://github.com/aikirun/aiki/blob/main/.env.test.example)).
- Schema sources:
    - `sdk/server/src/infra/db/pg/schema.ts`
    - `sdk/iam/src/infra/db/pg/schema.ts`
- Repository get-by-key methods return `T | null`, never `T | undefined` — coalesce drizzle's row access (`rows[0] ?? null`).

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

## Gotchas

- **Never hand-author or hand-edit `meta/` snapshot files.** Snapshots must come from the generator; a doctored snapshot misdescribes the schema and silently corrupts every future diff. Editing the *generated SQL* is fine (e.g., inserting a data backfill between statements).
- **Backfill before you drop.** When a migration replaces a column, order the statements: add new columns → backfill from the old column → drop the old column. Once the drop runs, the data is gone. If a new `CHECK` constraint depends on backfilled values, the backfill must cover every row the constraint binds, or the `ADD CONSTRAINT` fails on live data.
- **`timestampMs` columns are `timestamp with time zone` in Postgres**, mapped to epoch milliseconds by a custom type whose `toDriver` serializes ISO strings. Drizzle operators (`lte`, `eq`, …) apply the mapping automatically, but raw `` sql`...` `` fragments do NOT — binding an epoch number (or casting `::bigint`) into a timestamptz column fails at runtime and typechecks fine. In raw fragments, bind `new Date(ms).toISOString()` with `::timestamptz`. Similarly, `` sql<Date>`${column}` `` strips the decoder — chain `.mapWith(column)`.
- Apply migrations only when explicitly asked; the operator runs them (see AGENTS working rules).
