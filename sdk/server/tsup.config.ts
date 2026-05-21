import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "index.ts",
		config: "config.ts",
		"infra/db/pg/migrate": "infra/db/pg/migrate.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
	noExternal: ["@aikirun/lib"],
});
