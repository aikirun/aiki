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
			state: { status: "running" },
			tasksState: {},
			subWorkflowsRunState: {},
		},
	};
});

const getStateV1 = os.getStateV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run state for id: ${input.id}`);
	return {
		state: {
			status: "completed",
			output: { success: true, data: "mock data" },
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
			state: { status: "queued" },
			tasksState: {},
			subWorkflowsRunState: {},
		},
	};
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input: _input }) => {
	return {};
});

const transitionStateV1 = os.transitionStateV1.handler(({ input: _input }) => {
	return {};
});

export const workflowRunRouter = os.router({
	getByIdV1,
	getStateV1,
	createV1,
	transitionTaskStateV1,
	transitionStateV1,
});
