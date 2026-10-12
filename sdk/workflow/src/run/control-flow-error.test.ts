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

import { type ControlFlowError, isControlFlowError } from "./control-flow-error";

describe("isControlFlowError", () => {
	const runId = "run-1" as WorkflowRunId;
	const controlFlowErrors: { [Member in ControlFlowError as Member["name"]]: Member } = {
		WorkflowRunSuspendedError: new WorkflowRunSuspendedError(runId),
		WorkflowRunStateUnknownError: new WorkflowRunStateUnknownError(runId, new Error("fetch failed")),
		WorkflowRunRevisionConflictError: new WorkflowRunRevisionConflictError(runId),
		WorkflowRunFailedError: new WorkflowRunFailedError(runId, 1),
		WorkflowRunNotExecutableError: new WorkflowRunNotExecutableError(runId, "paused"),
		NonDeterminismError: new NonDeterminismError(runId, 1, { taskIds: [], childWorkflowRunIds: [] }),
		ClientCodecMissingError: new ClientCodecMissingError(runId),
	};

	for (const [name, error] of Object.entries(controlFlowErrors)) {
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
