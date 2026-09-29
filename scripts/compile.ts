// Compiles an entrypoint into a standalone Bun executable.
//
//   bun scripts/compile.ts <entrypoint> --outfile <path> [--target <bun target>]
//
// libsql loads its native addon with require(`@libsql/${target}`), a package name built at runtime
// that the bundler cannot follow, so the executable would ship without the addon. The plugin
// rewrites that require to the addon package of the target being compiled, which the bundler then
// embeds. Compiling for another platform needs that platform's addon installed, which
// `bun install --os=<os> --cpu=<cpu>` does.
import process from "node:process";
import { parseArgs } from "node:util";
import type { BunPlugin } from "bun";

const LIBSQL_ADDON_BY_TARGET = {
	"bun-darwin-arm64": "@libsql/darwin-arm64",
	"bun-linux-x64": "@libsql/linux-x64-gnu",
	"bun-linux-arm64": "@libsql/linux-arm64-gnu",
	"bun-linux-x64-musl": "@libsql/linux-x64-musl",
	"bun-linux-arm64-musl": "@libsql/linux-arm64-musl",
} satisfies Partial<Record<Bun.Build.CompileTarget, string>>;

type MappedTarget = keyof typeof LIBSQL_ADDON_BY_TARGET;

function isMappedTarget(value: string): value is MappedTarget {
	return Object.hasOwn(LIBSQL_ADDON_BY_TARGET, value);
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: this is libsql's source text, which is itself a template literal
const LIBSQL_ADDON_REQUIRE = "require(`@libsql/${target}`)";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		outfile: { type: "string" },
		target: { type: "string" },
	},
	allowPositionals: true,
});

const [entrypoint] = positionals;
if (!entrypoint || !values.outfile) {
	throw new Error("usage: bun scripts/compile.ts <entrypoint> --outfile <path> [--target <bun target>]");
}

const target = values.target ?? `bun-${process.platform}-${process.arch}`;
if (!isMappedTarget(target)) {
	throw new Error(`no libsql addon is mapped for ${target}; add it to LIBSQL_ADDON_BY_TARGET`);
}
const libsqlAddon = LIBSQL_ADDON_BY_TARGET[target];

let rewrittenLibsqlLoaders = 0;
const embedLibsqlAddon: BunPlugin = {
	name: "embed-libsql-addon",
	setup(build) {
		build.onLoad({ filter: /[\\/]node_modules[\\/]libsql[\\/](index|promise)\.js$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			if (!source.includes(LIBSQL_ADDON_REQUIRE)) {
				throw new Error(`libsql no longer loads its addon with ${LIBSQL_ADDON_REQUIRE}: ${args.path}`);
			}
			rewrittenLibsqlLoaders++;
			return {
				contents: source.replace(LIBSQL_ADDON_REQUIRE, `require(${JSON.stringify(libsqlAddon)})`),
				loader: "js",
			};
		});
	},
};

const result = await Bun.build({
	entrypoints: [entrypoint],
	plugins: [embedLibsqlAddon],
	compile: { target, outfile: values.outfile },
});
if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}
if (rewrittenLibsqlLoaders === 0) {
	throw new Error(`${entrypoint} does not bundle libsql, so the executable has no sqlite driver`);
}

console.log(`compiled ${values.outfile} for ${target}`);
