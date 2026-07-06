import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { DATABASE_PROVIDERS } from "@aikirun/lib/db";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/bin.ts"],
	format: ["esm"],
	// bin.js is reached through the bin map, never imported — no dts for it
	dts: { entry: "src/index.ts" },
	clean: true,
	outDir: "dist",
	noExternal: ["@aikirun/lib"],
	async onSuccess() {
		for (const provider of DATABASE_PROVIDERS) {
			const sourceDir = path.join("src", "infra", "db", provider, "migration");
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
