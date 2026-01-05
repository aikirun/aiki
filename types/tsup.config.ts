import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		client: "client.ts",
		duration: "duration.ts",
		event: "event.ts",
		retry: "retry.ts",
		serializable: "serializable.ts",
		sleep: "sleep.ts",
		symbols: "symbols.ts",
		task: "task.ts",
		trigger: "trigger.ts",
		utils: "utils.ts",
		worker: "worker.ts",
		workflow: "workflow.ts",
		"workflow-run": "workflow-run.ts",
		"workflow-run-api": "workflow-run-api.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
