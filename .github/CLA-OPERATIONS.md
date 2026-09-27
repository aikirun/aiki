# Operating the CLA check

How the Contributor License Agreement gate works, and how to rebuild or change it. The
agreements themselves are [CLA.md](./CLA.md) (individual) and [CCLA.md](./CCLA.md) (corporate).

## How it works

A pull request is blocked until its author has agreed. `.github/workflows/cla.yml` posts a
comment linking to `CLA.md`; the author replies with the exact phrase; the action appends them
to `signatures/version1/cla.json` and turns the status check green.

One signature covers everything that author ever contributes — and everything they contributed
before, which section 2 of the agreement brings into scope.

## The signature branch

Signatures live on a dedicated `cla-signatures` branch, never on `main`. That keeps the bot off
a protected branch, so it needs no personal access token and no branch-protection exception.
The branch holds nothing but the signature file and is never merged.

**The check does nothing until this branch exists.** If the bot posts no comment on a PR, that
is almost always why.

To create it, or rebuild it if it is lost — this runs in a throwaway clone, so it cannot
disturb your working tree:

```bash
tmp=$(mktemp -d)
git clone --depth 1 https://github.com/aikirun/aiki.git "$tmp/aiki"
cd "$tmp/aiki"
git switch --orphan cla-signatures
mkdir -p signatures/version1
printf '{"signedContributors":[]}\n' > signatures/version1/cla.json
git add signatures/version1/cla.json
git commit -m "Initialise CLA signature store"
git push origin cla-signatures
cd - && rm -rf "$tmp"
```

Losing the branch loses the record of who agreed, not the agreements themselves — but there is
no way to reconstruct it, so treat it as data.

## The required check

Enforcement comes from branch protection, not from the workflow: Settings → Branches → the
`main` rule → **Require status checks to pass before merging**.

The action reports a commit status rather than a job, so **the name to add there does not match
the job name in the workflow file**, and it does not appear in the list until it has run at
least once. Open a throwaway PR and read the name off it.

## Smoke test

Worth running after changing the action version or its inputs. From an account that is **not**
on the allowlist:

1. The bot comments asking for agreement.
2. The check sits red.
3. Replying with `I have read the CLA Document and I hereby sign the CLA` flips it green.
4. `signatures/version1/cla.json` on `cla-signatures` gains an entry.

## Day-to-day

- **Re-run a stuck check** by commenting `recheck` on the pull request.
- **Corporate contributors** — where an employer owns the work — additionally need
  [CCLA.md](./CCLA.md), handled by email rather than by the bot. The bot cannot detect this
  case; it surfaces when a contributor says so, or when a PR is plainly work-for-hire.
- **Allowlist changes** go in `.github/workflows/cla.yml` under `allowlist`.
- **Contributors from before the bot** are invisible to it — it only sees new pull requests. If
  they have a branch open, let the bot ask them there; signing covers their earlier work too.
  Otherwise ask by email and record the reply.
- **Changing the agreement.** Typos and reformatting are fine in place. For a material change to
  the grants or representations, bump `path-to-signatures` to `signatures/version2/cla.json` so
  everyone is asked again — the signature record stores no copy of the text they agreed to.

## Upstream

`contributor-assistant/github-action` is no longer actively maintained. It is pinned to a commit
SHA, so nothing shifts underneath us, but there will be no security fixes. If that becomes
unacceptable, the alternatives are forking it or moving to the hosted CLA Assistant service.
