import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		"array/index": "array/index.ts",
		"async/index": "async/index.ts",
		"crypto/index": "crypto/index.ts",
		"duration/index": "duration/index.ts",
		"error/index": "error/index.ts",
		"json/index": "json/index.ts",
		"object/index": "object/index.ts",
		"path/index": "path/index.ts",
		"polling/index": "polling/index.ts",
		"retry/index": "retry/index.ts",
		"testing/expect/index": "testing/expect/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
