# Releasing Aiki

1. `bun run bump <version>` — sets the lockstep version across every package,
   and stamps `deploy/docker-compose.yml` image pins plus the docs' `--branch`
   pins.
2. Commit the bump and get it onto `main`.
3. Run the release: `gh workflow run release.yml`, or the **Run workflow**
   button on the Release workflow in the Actions tab. There is no version input
   — it comes from the committed `types/package.json`.

The workflow runs **verify → tag → images → deploy-cloud → publish**. `verify`
runs the full battery — type-check, lint, test, migration scripts, package builds,
tarball/migration parity, and the `aiki` binary compile. Only when it passes
does the `tag` job create and push `v<version>`. A failed verify creates no tag,
so a bad release leaves nothing to clean up. Re-running a partially-failed
release is safe: the tag step no-ops on a matching commit, image pushes
overwrite, and npm publish skips already-published packages. `publish` (npm plus
the GitHub release) runs last because it is the only irreversible step.
