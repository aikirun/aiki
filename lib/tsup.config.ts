import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		"address/index": "src/address/index.ts",
		"array/index": "src/array/index.ts",
		"async/index": "src/async/index.ts",
		"context/index": "src/context/index.ts",
		"crypto/index": "src/crypto/index.ts",
		"duration/index": "src/duration/index.ts",
		"error/index": "src/error/index.ts",
		"json/index": "src/json/index.ts",
		"logger/index": "src/logger/index.ts",
		"object/index": "src/object/index.ts",
		"polling/index": "src/polling/index.ts",
		"retry/index": "src/retry/index.ts",
		"serializable/index": "src/serializable/index.ts",
		"testing/expect/index": "src/testing/expect/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
