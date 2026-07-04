// Creates the release tag after verifying the checkout is releasable: clean
// tree, on main, every workspace package at the same version, the standalone
// compose file's image pins stamped to it, and the tag not already taken.
// CI's verify job repeats these checks — tags can be created without this
// script, so CI stays the authority.
//
// Usage:  bun run tag   (then: git push --follow-tags)
import { $ } from "bun";

const status = (await $`git status --porcelain`.text()).trim();
if (status !== "") {
	console.error("working tree is not clean — commit or stash first");
	process.exit(1);
}

const branch = (await $`git branch --show-current`.text()).trim();
if (branch !== "main") {
	console.error(`on branch ${branch} — releases are tagged from main`);
	process.exit(1);
}

const { version } = (await Bun.file("types/package.json").json()) as { version: string };

const { workspaces } = (await Bun.file("package.json").json()) as { workspaces: string[] };
const mismatchedPackages: string[] = [];
for (const dir of workspaces) {
	const workspacePackage = (await Bun.file(`${dir}/package.json`).json()) as { version?: string };
	if (workspacePackage.version !== version) {
		mismatchedPackages.push(`${dir} is at ${workspacePackage.version}`);
	}
}
if (mismatchedPackages.length > 0) {
	console.error(`workspace versions are not all ${version} — run bun run bump`);
	for (const mismatch of mismatchedPackages) {
		console.error(`  ${mismatch}`);
	}
	process.exit(1);
}

const composeText = await Bun.file("deploy/docker-compose.yml").text();
const pins = composeText.match(/aikirun\/[a-z]+:[\w.-]+/g) ?? [];
const stalePins = pins.filter((pin) => !pin.endsWith(`:${version}`));
if (pins.length === 0 || stalePins.length > 0) {
	console.error(`deploy/docker-compose.yml pins are not at ${version} — run bun run bump`);
	for (const pin of stalePins) {
		console.error(`  ${pin}`);
	}
	process.exit(1);
}

const tag = `v${version}`;
const existing = await $`git rev-parse --quiet --verify refs/tags/${tag}`.nothrow().quiet();
if (existing.exitCode === 0) {
	console.error(`tag ${tag} already exists`);
	process.exit(1);
}

await $`git tag -a ${tag} -m ${tag}`;
console.log(`created ${tag} — push with: git push --follow-tags`);
