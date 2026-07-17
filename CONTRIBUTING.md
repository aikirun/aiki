# Contributing to Aiki

Thanks for helping build Aiki! This is a short guide to getting a local dev
environment running. For cutting releases, see [`.github/RELEASING.md`](.github/RELEASING.md).

## Docs & design

- **User documentation:** <https://aiki.run/docs>. The source lives in this repo
  under [`app/website/content/docs`](app/website/content/docs) — edit it there
  and run `bun run website` to preview.
- **Design docs** (deeper architecture & design discussion) live in a separate
  repo: <https://github.com/aikirun/design-docs>.

## Prerequisites

- **[Bun](https://bun.sh) 1.0+** — Aiki is a Bun workspace. `npm` and `pnpm`
  won't work at the repo root (the internal packages link via the `workspace:*`
  protocol, which only Bun/pnpm/Yarn understand — `npm install` here fails with
  `EUNSUPPORTEDPROTOCOL`).
- **Git**
- **PostgreSQL** — only needed to run the server or examples end-to-end. The
  test suite does not require a database.

## Set up

```bash
git clone https://github.com/aikirun/aiki.git
cd aiki
bun install
```

Always use `bun install`, never `npm install` — see the note above.

## Everyday commands

Run these from the repo root:

| Command | What it does |
| --- | --- |
| `bun test` | Run the test suite (no database needed) |
| `bun run check` | Type-check every package with `tsc` |
| `bun run lint` | Lint & format check with Biome |
| `bun run lint:fix` | Auto-fix lint/format issues |
| `bun run build:packages` | Build the publishable SDK packages |

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

## Before you open a PR

```bash
bun run check && bun run lint && bun test
```

A Husky pre-commit hook auto-formats staged files with Biome, so formatting is
handled for you on commit. A pre-push hook type-checks your changes with
`bun run check` before they leave your machine; if the push touches `app/website`
it first regenerates the docs types. Commits stay fast so you can freely save
work in progress.

## TODO — planned additions to this guide

- **PR creation guidance.** Add a [`.github/PULL_REQUEST_TEMPLATE.md`](.github)
  (summary, linked issue, test plan, and a check/lint/test checklist) plus a
  short "Opening a PR" section here covering branch naming, keeping PRs focused,
  and the commit-message convention.
- **AI agent guidance & skills.** Add a root `AGENTS.md` (and/or `CLAUDE.md`)
  documenting the build/test commands, repo conventions, and the Bun-not-npm
  rule so coding agents get it right. Optionally add reusable Claude Code
  **skills** under `.claude/skills/` for repeatable chores (e.g. generating a DB
  migration, running the release). None of this is covered by `.github` today.
