import { baseImplementer } from "./base.ts";

const os = baseImplementer.workflowRun;

const getByIdV1 = os.getByIdV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run by id: ${input.id}`);
	return {
		run: {
			id: input.id,
			name: "evening-routine",
			versionId: "1.0.0",
			input: null,
			options: {},
			result: { state: "running" },
			tasksState: {},
			subWorkflowsRunResult: {},
		},
	};
});

const getResultV1 = os.getResultV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run result for id: ${input.id}`);
	return {
		result: {
			state: "completed",
			output: { success: true, data: "mock result" },
		},
	};
});

const createV1 = os.createV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Creating workflow run: ${input.name}@${input.versionId}`);
	const runId = `workflow_run_${Date.now()}`;
	return {
		run: {
			id: runId,
			name: input.name,
			versionId: input.versionId,
			input: input.input,
			options: input.options ?? {},
			result: { state: "queued" },
			tasksState: {},
			subWorkflowsRunResult: {},
		},
	};
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input: _input }) => {
	return {};
});

const updateStateV1 = os.updateStateV1.handler(({ input: _input }) => {
	return {};
});

export const workflowRunRouter = os.router({
	getByIdV1,
	getResultV1,
	createV1,
	transitionTaskStateV1,
	updateStateV1,
});
