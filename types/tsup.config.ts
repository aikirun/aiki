import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
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
