# Releasing Aiki

1. `bun run bump <version>` — sets the lockstep version across every package,
   and stamps `deploy/docker-compose.yml` image pins plus the docs' `--branch`
   pins.
2. Commit the bump and get it onto `main`.
3. Run the release: `gh workflow run release.yml`, or the **Run workflow**
   button on the Release workflow in the Actions tab. There is no version input
   — it comes from the committed `types/package.json`.

The workflow runs **verify**, **integration-test** and **image-smoke-test** before creating any side
effects. Only when all three pass does it create tags, make deployments or publish artefacts.
Re-running a failed release workflow is safe: the tag step no-ops on a matching commit, docker image pushes overwrite, and npm publish skips already-published packages.
If new commit have been added to `main` since the last release but the version has not been bumped
in code, the **verify** step will block the release.

## Redeploying or rolling back the hosted deployment

`deploy-server`, `deploy-dashboard` and `deploy-website` are reusable workflows
the release calls. Each is also dispatchable on its own from the Actions tab
via **Run workflow**, to redeploy or roll back without cutting a new release.

**Deploy server** takes a `version` (without the `v` prefix) and always deploys
that released version's image.

**Deploy dashboard** and **Deploy website** take an optional git `ref`: leave
it blank to deploy the current `main`, or pass a tag like `v0.34.1` to redeploy
that release. Deploying the dashboard from `main` is for dashboard-only fixes —
the hosted server stays on the last release, so the change must not depend on
server APIs that haven't shipped.
