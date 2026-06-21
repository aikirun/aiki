import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		"address/index": "src/address/index.ts",
		"async/index": "src/async/index.ts",
		"collection/array/index": "src/collection/array/index.ts",
		"collection/heap/index": "src/collection/heap/index.ts",
		"config/index": "src/config/index.ts",
		"context/index": "src/context/index.ts",
		"crypto/index": "src/crypto/index.ts",
		"duration/index": "src/duration/index.ts",
		"error/index": "src/error/index.ts",
		"id/index": "src/id/index.ts",
		"json/index": "src/json/index.ts",
		"logger/index": "src/logger/index.ts",
		"object/index": "src/object/index.ts",
		"retry/index": "src/retry/index.ts",
		"serializable/index": "src/serializable/index.ts",
		"testing/expect/index": "src/testing/expect/index.ts",
		"timestamp/index": "src/timestamp/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
