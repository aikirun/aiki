# Releasing Aiki

How Aiki ships, and the one-time setup behind it.

## Cutting a release

1. `bun run bump <version>` — sets the lockstep version across every package,
   and stamps `deploy/docker-compose.yml` image pins plus the docs' `--branch`
   pins.
2. Commit the bump.
3. `bun run tag` — creates the annotated `v<version>` tag after checking: clean
   tree, on `main`, all workspace versions equal, compose pins stamped, tag not
   already present.
4. `git push --follow-tags`.

The tag push triggers `.github/workflows/release.yml`: **verify → images →
deploy-cloud → publish**.
