# Local End-to-End Run (Server + Dashboard)

1. Prepare env and DB. The example env uses SQLite, so the database is a file (`app/server/aiki.db`) and there is nothing else to start:

```bash
cp app/server/.env.example app/server/.env
bun run --cwd app/server db:migrate:apply
```

2. Run apps (separate terminals):

```bash
bun run server
bun run dashboard
bun run website
```

To run on Postgres instead, start a container, switch `app/server/.env` to its Postgres lines, then apply the migrations:

```bash
docker run --name aiki-pg -p 5432:5432 \
	-e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=aiki \
	-d postgres:16
```

## Examples

```bash
cp examples/.env.example examples/.env
bun sdk/server/src/bin.ts migrate apply --env-file examples/.env
bun run examples/src/scenarios/echo.ts
```
