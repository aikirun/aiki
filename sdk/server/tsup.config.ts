import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { DATABASE_PROVIDERS } from "@aikirun/types/infra/db";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"config/index": "src/config/index.ts",
	},
	format: ["esm"],
	dts: true,
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
