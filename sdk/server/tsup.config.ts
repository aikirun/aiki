import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "tsup";

import { DATABASE_PROVIDERS } from "./config";

export default defineConfig({
	entry: {
		index: "index.ts",
		"config/index": "config/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
	noExternal: ["@aikirun/lib"],
	async onSuccess() {
		for (const provider of DATABASE_PROVIDERS) {
			const sourceDir = path.join("infra", "db", provider, "migration");
			const targetDir = path.join("dist", "infra", "db", provider, "migration");
			try {
				await readdir(sourceDir);
			} catch {
				continue;
			}
			await mkdir(targetDir, { recursive: true });
			await cp(sourceDir, targetDir, { recursive: true });
		}
	},
});
