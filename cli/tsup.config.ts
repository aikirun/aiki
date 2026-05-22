import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
	banner: { js: "#!/usr/bin/env node" },
	target: "node20",
	noExternal: ["@aikirun/lib"],
});
