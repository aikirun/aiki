# Local End-to-End Run (Server + Dashboard)

1. Start Postgres:

```bash
docker run --name aiki-pg -p 5432:5432 \
	-e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=aiki \
	-d postgres:16
```

2. Prepare env and DB:

```bash
cp app/server/.env.example app/server/.env
bun run --cwd app/server db:migrate:apply
```

3. Run apps (separate terminals):

```bash
bun run server
bun run dashboard
bun run website
```

## Examples

```bash
cp examples/.env.example examples/.env
bun run examples/src/scenarios/echo.ts
```
