// Smoke-tests the built packages the way someone who installs them meets them.
//
// Inside the workspace, tsconfig `paths` resolve `@aikirun/*` imports straight
// to source and dev-only packages are linked in, so typecheck, build and tests
// never read a package's `exports` and never lack a package an install would
// not have. This packs every published package as `bun publish` would,
// installs the tarballs into an empty project outside the workspace, and
// imports every entry point of every package there: through `tsc` with
// `skipLibCheck` off, then at runtime.
//
// Usage:  bun run build:packages && bun run smoke-test:packages
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

interface PackageManifest {
	name: string;
	version: string;
	private?: boolean;
	exports?: Record<string, unknown>;
}

const { workspaces } = (await Bun.file("package.json").json()) as { workspaces: string[] };
const typescript = (await Bun.file("node_modules/typescript/package.json").json()) as PackageManifest;
const nodeTypes = (await Bun.file("node_modules/@types/node/package.json").json()) as PackageManifest;

const projectDir = await mkdtemp(join(tmpdir(), "aiki-smoke-test-"));

const tarballsByPackageName: Record<string, string> = {};
const entryImports: string[] = [];
for (const dir of workspaces) {
	const manifest = (await Bun.file(join(dir, "package.json")).json()) as PackageManifest;
	if (manifest.private) {
		continue;
	}

	const tarballPath = await $`bun pm pack --destination ${projectDir} --quiet`.cwd(dir).text();
	tarballsByPackageName[manifest.name] = `file:${tarballPath.trim()}`;

	for (const exportKey of Object.keys(manifest.exports ?? {})) {
		if (exportKey === "./package.json") {
			continue;
		}
		entryImports.push(`export * as entry${entryImports.length} from "${manifest.name}${exportKey.slice(1)}";`);
	}
}

await Bun.write(
	join(projectDir, "package.json"),
	JSON.stringify({
		private: true,
		type: "module",
		dependencies: tarballsByPackageName,
		// A packed package pins its siblings by version, which the install would fetch from the registry.
		overrides: tarballsByPackageName,
		devDependencies: { typescript: typescript.version, "@types/node": nodeTypes.version },
	})
);
await Bun.write(
	join(projectDir, "tsconfig.json"),
	JSON.stringify({
		compilerOptions: {
			strict: true,
			module: "ESNext",
			moduleResolution: "bundler",
			target: "ES2022",
			noEmit: true,
			skipLibCheck: false,
			types: ["node"],
		},
		include: ["entries.ts"],
	})
);
await Bun.write(join(projectDir, "entries.ts"), entryImports.join("\n"));

await $`bun install`.cwd(projectDir);
await $`bun x tsc`.cwd(projectDir);
await $`bun entries.ts`.cwd(projectDir);

await rm(projectDir, { recursive: true });
console.log(
	`${entryImports.length} entry points of ${Object.keys(tarballsByPackageName).length} packages type-check and load from an install`
);
