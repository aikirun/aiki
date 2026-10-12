import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	ClientCodecMissingError,
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import type { TaskId } from "@aikirun/types/workflow/task";
import { TaskFailedError } from "@aikirun/types/workflow/task";
import { describe, expect, test } from "vitest";

import { isControlFlowError } from "./control-flow-error";

describe("isControlFlowError", () => {
	const runId = "run-1" as WorkflowRunId;
	const controlFlowErrors: Array<{ name: string; error: Error }> = [
		{ name: "WorkflowRunSuspendedError", error: new WorkflowRunSuspendedError(runId) },
		{ name: "WorkflowRunStateUnknownError", error: new WorkflowRunStateUnknownError(runId, new Error("fetch failed")) },
		{ name: "WorkflowRunRevisionConflictError", error: new WorkflowRunRevisionConflictError(runId) },
		{ name: "WorkflowRunFailedError", error: new WorkflowRunFailedError(runId, 1) },
		{ name: "WorkflowRunNotExecutableError", error: new WorkflowRunNotExecutableError(runId, "paused") },
		{
			name: "NonDeterminismError",
			error: new NonDeterminismError(runId, 1, { taskIds: [], childWorkflowRunIds: [] }),
		},
		{ name: "ClientCodecMissingError", error: new ClientCodecMissingError(runId) },
	];

	for (const { name, error } of controlFlowErrors) {
		test(`is true for ${name}`, () => {
			expect(isControlFlowError(error)).toBe(true);
		});
	}

	test("is false for TaskFailedError", () => {
		expect(isControlFlowError(new TaskFailedError("task-1" as TaskId, 1, "declined"))).toBe(false);
	});

	test("is false for a plain Error", () => {
		expect(isControlFlowError(new Error("boom"))).toBe(false);
	});
});
