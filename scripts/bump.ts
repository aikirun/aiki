// Lockstep version bump for the whole workspace.
//
// Sets every workspace package to the same version, then regenerates the
// lockfile. The lockfile refresh is important: `bun publish` reads workspace
// versions from it when rewriting `workspace:*` into concrete cross-package
// pins, so a stale lockfile would publish packages pinned to old sibling versions.
//
// Usage:  bun run bump 0.31.0
import { $ } from "bun";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
	console.error("usage: bun run bump <version>   (e.g. bun run bump 0.31.0)");
	process.exit(1);
}

const { workspaces } = (await Bun.file("package.json").json()) as { workspaces: string[] };
for (const dir of workspaces) {
	const path = `${dir}/package.json`;
	const text = await Bun.file(path).text();
	await Bun.write(path, text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
	console.log(`  ${dir} → ${version}`);
}

await $`rm -f bun.lock`;
await $`bun install`;
await $`bun run lint:fix`;
