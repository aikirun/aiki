import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		utils: "utils.ts",
		symbols: "symbols.ts",
		duration: "duration.ts",
		retry: "retry.ts",
		error: "error.ts",
		client: "client.ts",
		trigger: "trigger.ts",
		workflow: "workflow.ts",
		"workflow-run": "workflow-run.ts",
		"workflow-run-api": "workflow-run-api.ts",
		task: "task.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
