# Contributing to Aiki

Thanks for helping build Aiki! This is a short guide to getting a local dev
environment running. For cutting releases, see [`.github/RELEASING.md`](.github/RELEASING.md).

## Docs

- **User documentation:** <https://aiki.run/docs>. The source lives in this repo
  under [`app/website/content/docs`](app/website/content/docs) — edit it there
  and run `bun run website` to preview.

## Prerequisites

- **[Bun](https://bun.sh) 1.0+** — Aiki is a Bun workspace. `npm` and `pnpm`
  won't work at the repo root (the internal packages link via the `workspace:*`
  protocol, which only Bun/pnpm/Yarn understand — `npm install` here fails with
  `EUNSUPPORTEDPROTOCOL`).
- **Git**
- **PostgreSQL** — needed to run the server or examples end-to-end, and to run
  the integration tests (`bun run test:integration`).
  The unit tests (`bun run test:unit`) need no database.

## Set up

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
bun install
```

Always use `bun install`, never `npm install` — see the note above.

## Everyday commands

Run these from the repo root:

| Command                    | What it does                                                           |
| -------------------------- | ---------------------------------------------------------------------- |
| `bun run test:unit`        | Run the unit test suite (no database needed)                           |
| `bun run test:integration` | Run the integration tests (needs a Postgres test database — see below) |
| `bun run check`            | Type-check every package with `tsc`                                    |
| `bun run lint`             | Lint & format check with Biome                                         |
| `bun run lint:fix`         | Auto-fix lint/format issues                                            |
| `bun run build:packages`   | Build the publishable SDK packages                                     |

## Run the server + dashboard locally

1. Start a Postgres matching the default connection string:

    ```bash
    docker run --name aiki-pg -p 5432:5432 \
      -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=aiki \
      -d postgres:16
    ```

2. Create the server env file and apply migrations:

    ```bash
    cp app/server/.env.example app/server/.env
    bun run --cwd app/server db:migrate:apply
    ```

3. Run the pieces (each in its own terminal):

    ```bash
    bun run server      # API server on http://localhost:9850
    bun run dashboard   # dashboard on http://localhost:9851
    bun run website     # docs site
    ```

## Run an example

The examples run everything in one process (server + workers), so they only need
a database.

```bash
cp examples/.env.example examples/.env          # defaults to embedded mode
bun run examples/src/scenarios/echo.ts          # or any other scenario
```

## Changing the database schema

Schemas are defined in TypeScript with Drizzle, one per service:

- Server: [`sdk/server/src/infra/db/pg/schema.ts`](sdk/server/src/infra/db/pg/schema.ts)
- IAM: [`sdk/iam/src/infra/db/pg/schema.ts`](sdk/iam/src/infra/db/pg/schema.ts)

After editing a schema, generate a migration:

```bash
bun run db:migrate:generate                    # both services
bun run --cwd sdk/server db:migrate:generate   # or a single service
```

This diffs the schema against the stored snapshot and writes a new numbered
`.sql` file into that service's `src/infra/db/pg/migration/`, updating the
`meta/` snapshot. No database is needed — it's a pure schema diff. Commit the
generated `.sql` and `meta/` files together with the schema change.

For changes Drizzle can't infer (data backfills, hand-written SQL), generate an
empty migration to fill in yourself:

```bash
bun run --cwd sdk/server db:migrate:generate:custom
```

To apply and test them against your local database, use the **Run the server +
dashboard locally** step above (`bun run --cwd app/server db:migrate:apply`).

## Integration tests

Unit tests (`bun run test:unit`) need no backing services. Integration tests
(`bun run test:integration`) need two: a Postgres they truncate every table in
between tests — so it must be a **dedicated** test database, never a real one —
and a Redis for the redis adapter's tests.

```bash
docker exec aiki-pg createdb -U user aiki_test    # test database in the Postgres started above
docker run --name aiki-redis -p 6379:6379 -d redis:7
cp .env.test.example .env.test    # defaults match the two containers above
bun run test:db:migrate:apply     # apply the server + iam migrations to the test database
bun run test:integration
```

`DATABASE_URL` and `REDIS_URL` in `.env.test` point the suite elsewhere.

CI runs all of this automatically against throwaway Postgres and Redis services,
so opening a PR does not require local services — but run the tests locally when
your change touches the database layer or a timer-queue adapter.

## Before you open a PR

```bash
bun run check && bun run lint && bun run test:unit
```

A Husky pre-commit hook auto-formats staged files with Biome, so formatting is
handled for you on commit. A pre-push hook type-checks your changes with
`bun run check` before they leave your machine; if the push touches `app/website`
it first regenerates the docs types. Commits stay fast so you can freely save
work in progress.

## Contributor License Agreement

Your first pull request needs a one-time agreement to the
[Contributor License Agreement](.github/CLA.md). A bot will comment with instructions;
reply with the phrase it gives you and the check goes green. You are asked once, and it covers everything you contribute afterwards — and anything you
contributed before.

**You keep the copyright in your work.** You are granting Aiki a licence to use
it, including the right to distribute it under different terms in future. You
remain free to use your own contributions anywhere else.

If your employer owns the code you write — which is what many employment
contracts say, including for work done on your own time — your personal signature is not enough. Point them at the [Corporate CLA](.github/CCLA.md) and email
oluwafemi.shobande@aiki.run.

## TODO — planned additions to this guide

- **PR creation guidance.** Add a [`.github/PULL_REQUEST_TEMPLATE.md`](.github)
  (summary, linked issue, test plan, and a check/lint/test checklist) plus a
  short "Opening a PR" section here covering branch naming, keeping PRs focused,
  and the commit-message convention.
