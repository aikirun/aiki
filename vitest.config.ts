import { defineConfig } from "vitest/config";

// Runs the test suite on Node. `bun test` does not read this file.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		// By default Vitest gives a default import of a CommonJS package its `default` property, as Bun does.
		// Node gives it the whole exports object. With the default on, code that only works on Bun passes here.
		deps: { interopDefault: false },
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["**/*.test.ts"],
					exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
				},
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["**/*.integration.test.ts"],
					exclude: ["**/node_modules/**", "**/dist/**"],
					// The files share one database and one frozen clock, so they run one at a time.
					fileParallelism: false,
				},
			},
		],
	},
});
