# Releasing Aiki

1. `bun run bump <version>` — sets the lockstep version across every package,
   and stamps `deploy/docker-compose.yml` image pins plus the docs' `--branch`
   pins.
2. Commit the bump and get it onto `main`.
3. Run the release: `gh workflow run release.yml`, or the **Run workflow**
   button on the Release workflow in the Actions tab. There is no version input
   — it comes from the committed `types/package.json`.

The workflow runs a **verify** step before creating any side effects. Only when that step passes
does it create tags, make deployments or publish artefacts.
Re-running a failed release workflow is safe: the tag step no-ops on a matching commit, docker image pushes overwrite, and npm publish skips already-published packages.
If new commit have been added to `main` since the last release but the version has not been bumped
in code, the **verify** step will block the release.

## Redeploying or rolling back the hosted deployment

`deploy-server` and `deploy-dashboard` are reusable workflows the release calls. 
Each is also dispatchable on its own — Actions tab → **Deploy server** or
**Deploy dashboard** → **Run workflow** → enter a `version` (without the `v`
prefix). Use this to redeploy or roll back the hosted server or dashboard to an
already-released version without cutting a new release.
