import { implement } from "@orpc/server";
import { workflowRunContract } from "@aiki/contract/workflow-run";

const os = implement(workflowRunContract);

const getReadyIdsV1 = os.getReadyIdsV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching ready ids size: ${input.size}`);
	return {
		ids: ["1"],
	};
});

const getByIdV1 = os.getByIdV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run by id: ${input.id}`);
	return {
		run: {
			id: input.id,
			name: "test-workflow",
			versionId: "v1",
			payload: null,
			options: {},
			result: { state: "running" },
			subTasksRunResult: {},
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
			result: { success: true, data: "mock result" },
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
			payload: input.payload,
			options: input.options ?? {},
			result: { state: "queued" },
			subTasksRunResult: {},
			subWorkflowsRunResult: {},
		},
	};
});

const addSubTaskRunResultV1 = os.addSubTaskRunResultV1.handler(({ input: _input }) => {
	return {};
});

const updateStateV1 = os.updateStateV1.handler(({ input: _input }) => {
	return {};
});

export const workflowRunRouter = os.router({
	getReadyIdsV1,
	getByIdV1,
	getResultV1,
	createV1,
	addSubTaskRunResultV1,
	updateStateV1,
});
