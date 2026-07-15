import { withFakeClient } from "@aikirun/testing/client";
import {
	baseWorkflowRunRecordFactory,
	runningWorkflowRunRecordFactory,
	workflowRunStateByStatus,
} from "@aikirun/testing/workflow/run";
import { runningTaskInfoFactory } from "@aikirun/testing/workflow/task";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	WORKFLOW_RUN_STATUSES,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
} from "@aikirun/types/workflow/run";
import type { TransitionTaskStateToRunningCreate } from "@aikirun/types/workflow/task";

import { workflowRunHandle } from "./handle";
import { describe, expect, test } from "bun:test";

describe("workflowRunHandle", () => {
	describe("construction", () => {
		test("the record overload returns a handle to the given run synchronously", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build();

				const handle = workflowRunHandle(client, record);

				expect(handle.run).toEqual(record);
			}));

		test("the id overload fetches the run via getByIdV1", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });

				const handle = await workflowRunHandle(client, record.id as WorkflowRunId);

				expect(handle.run).toEqual(record);
			}));
	});

	describe("refresh", () => {
		test("refetches the run and replaces the held record", () =>
			withFakeClient(async (client) => {
				const initial = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, initial);

				const refreshed: WorkflowRunRecord = {
					...baseWorkflowRunRecordFactory.build({ id: initial.id }),
					state: { status: "completed", output: "done" },
				};
				client.api.workflowRun.getByIdV1.once({ id: initial.id }, { run: refreshed });

				await handle.refresh();

				expect(handle.run).toEqual(refreshed);
			}));
	});

	describe("transitionState", () => {
		test("uses the optimistic path with the run revision for a non-lifecycle transition", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 3, attempts: 1 });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{ type: "optimistic", id: record.id, state: { status: "running" }, expectedRevision: 3 },
					{ revision: 4, state: { status: "running" }, attempts: 2 }
				);

				await handle[INTERNAL].transitionState({ status: "running" });

				expect(handle.run.revision).toBe(4);
				expect(handle.run.attempts).toBe(2);
				expect(handle.run.state).toEqual({ status: "running" });
			}));

		test("maps a revision conflict to WorkflowRunRevisionConflictError", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 3 });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{ type: "optimistic", id: record.id, state: { status: "running" }, expectedRevision: 3 },
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				expect(handle[INTERNAL].transitionState({ status: "running" })).rejects.toBeInstanceOf(
					WorkflowRunRevisionConflictError
				);
			}));

		test("propagates a non-conflict error without mapping it", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 3 });
				const handle = workflowRunHandle(client, record);
				const nonConflictError = { code: "SOME_OTHER_ERROR" };

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{ type: "optimistic", id: record.id, state: { status: "running" }, expectedRevision: 3 },
					nonConflictError
				);

				expect(handle[INTERNAL].transitionState({ status: "running" })).rejects.toBe(nonConflictError);
			}));
	});

	describe("transitionTaskState", () => {
		test("injects the run id and revision and returns the task info", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 5 });
				const handle = workflowRunHandle(client, record);

				const taskInfo = runningTaskInfoFactory.build();
				const request: Omit<TransitionTaskStateToRunningCreate, "id" | "expectedWorkflowRunRevision"> = {
					type: "create",
					taskName: "reserve-seat",
					options: {},
					taskState: taskInfo.state,
				};
				client.api.workflowRun.transitionTaskStateV1.once(
					{ ...request, id: record.id, expectedWorkflowRunRevision: 5 },
					{ taskInfo }
				);

				const result = await handle[INTERNAL].transitionTaskState(request);

				expect(result).toEqual(taskInfo);
			}));

		test("maps a revision conflict to WorkflowRunRevisionConflictError", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 5 });
				const handle = workflowRunHandle(client, record);

				const request: Omit<TransitionTaskStateToRunningCreate, "id" | "expectedWorkflowRunRevision"> = {
					type: "create",
					taskName: "reserve-seat",
					options: {},
					taskState: { status: "running", attempts: 1, input: undefined },
				};
				client.api.workflowRun.transitionTaskStateV1.rejectsOnce(
					{ ...request, id: record.id, expectedWorkflowRunRevision: 5 },
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				expect(handle[INTERNAL].transitionTaskState(request)).rejects.toBeInstanceOf(WorkflowRunRevisionConflictError);
			}));

		test("propagates a non-conflict error without mapping it", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 5 });
				const handle = workflowRunHandle(client, record);
				const nonConflictError = { code: "SOME_OTHER_ERROR" };
				const request: Omit<TransitionTaskStateToRunningCreate, "id" | "expectedWorkflowRunRevision"> = {
					type: "create",
					taskName: "reserve-seat",
					options: {},
					taskState: { status: "running", attempts: 1, input: undefined },
				};
				client.api.workflowRun.transitionTaskStateV1.rejectsOnce(
					{ ...request, id: record.id, expectedWorkflowRunRevision: 5 },
					nonConflictError
				);

				expect(handle[INTERNAL].transitionTaskState(request)).rejects.toBe(nonConflictError);
			}));
	});

	describe("assertExecutionAllowed", () => {
		for (const status of WORKFLOW_RUN_STATUSES) {
			if (status === "queued" || status === "running") {
				test(`allows execution when the run is ${status}`, () =>
					withFakeClient((client) => {
						const record: WorkflowRunRecord = {
							...baseWorkflowRunRecordFactory.build(),
							state: workflowRunStateByStatus[status],
						};
						const handle = workflowRunHandle(client, record);

						expect(() => handle[INTERNAL].assertExecutionAllowed()).not.toThrow();
					}));
			} else {
				test(`throws WorkflowRunNotExecutableError when the run is ${status}`, () =>
					withFakeClient((client) => {
						const record: WorkflowRunRecord = {
							...baseWorkflowRunRecordFactory.build(),
							state: workflowRunStateByStatus[status],
						};
						const handle = workflowRunHandle(client, record);

						expect(() => handle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunNotExecutableError);
					}));
			}
		}
	});

	describe("lifecycle transitions take the pessimistic path", () => {
		test("cancel records the cancelled state and carries the reason", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 2 });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{ type: "pessimistic", id: record.id, state: { status: "cancelled", reason: "operator stopped it" } },
					{ revision: 3, state: { status: "cancelled" }, attempts: record.attempts }
				);

				await handle.cancel("operator stopped it");

				expect(handle.run.state).toEqual({ status: "cancelled" });
				expect(handle.run.revision).toBe(3);
			}));

		test("pause requests the paused state", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{ type: "pessimistic", id: record.id, state: { status: "paused" } },
					{ revision: record.revision + 1, state: { status: "paused" }, attempts: record.attempts }
				);

				await handle.pause();
			}));

		test("resume schedules the run immediately with reason 'resume'", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{ type: "pessimistic", id: record.id, state: { status: "scheduled", scheduledInMs: 0, reason: "resume" } },
					{
						revision: record.revision + 1,
						state: { status: "scheduled", scheduledAt: 0, reason: "resume" },
						attempts: record.attempts,
					}
				);

				await handle.resume();
			}));

		test("awake schedules the run immediately with reason 'awake_early'", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "pessimistic",
						id: record.id,
						state: { status: "scheduled", scheduledInMs: 0, reason: "awake_early" },
					},
					{
						revision: record.revision + 1,
						state: { status: "scheduled", scheduledAt: 0, reason: "new" },
						attempts: record.attempts,
					}
				);

				await handle.awake();
			}));
	});

	describe("waitForStatus", () => {
		test("returns success with the state when the run reaches the target status", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ stateTransitionId: "t0" });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.hasTerminatedV1.once(
					{ id: record.id, afterStateTransitionId: "t0" },
					{ terminated: true, latestStateTransitionId: "t1" }
				);
				const completed: WorkflowRunRecord = {
					...baseWorkflowRunRecordFactory.build({ id: record.id }),
					state: { status: "completed", output: "done" },
				};
				client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: completed });

				const result = await handle.waitForStatus("completed");

				expect(result).toEqual({ success: true, state: { status: "completed", output: "done" } });
			}));

		test("returns run_terminated when the run reaches a different terminal status", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ stateTransitionId: "t0" });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.hasTerminatedV1.once(
					{ id: record.id, afterStateTransitionId: "t0" },
					{ terminated: true, latestStateTransitionId: "t1" }
				);
				const failed: WorkflowRunRecord = {
					...baseWorkflowRunRecordFactory.build({ id: record.id }),
					state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
				};
				client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: failed });

				const result = await handle.waitForStatus("completed");

				expect(result).toEqual({ success: false, cause: "run_terminated" });
			}));

		test("polls until the run terminates, advancing the state-transition cursor", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ stateTransitionId: "t0" });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.hasTerminatedV1
					.once({ id: record.id, afterStateTransitionId: "t0" }, { terminated: false, latestStateTransitionId: "t1" })
					.once({ id: record.id, afterStateTransitionId: "t1" }, { terminated: true, latestStateTransitionId: "t2" });
				const completed: WorkflowRunRecord = {
					...baseWorkflowRunRecordFactory.build({ id: record.id }),
					state: { status: "completed", output: 42 },
				};
				client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: completed });

				const result = await handle.waitForStatus("completed", { interval: { milliseconds: 1 } });

				expect(result).toEqual({ success: true, state: { status: "completed", output: 42 } });
			}));

		test("returns timeout when the run has not terminated by the last poll", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ stateTransitionId: "t0" });
				const handle = workflowRunHandle(client, record);

				client.api.workflowRun.hasTerminatedV1.once(
					{ id: record.id, afterStateTransitionId: "t0" },
					{ terminated: false, latestStateTransitionId: "t1" }
				);

				// timeout <= interval means max poll attempts will be 1
				const result = await handle.waitForStatus("completed", {
					interval: { seconds: 2 },
					timeout: { seconds: 1 },
				});

				expect(result).toEqual({ success: false, cause: "timeout" });
			}));

		test("returns aborted immediately when the signal is already aborted", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, record);

				const controller = new AbortController();
				controller.abort();

				const result = await handle.waitForStatus("completed", { signal: controller.signal });

				expect(result).toEqual({ success: false, cause: "aborted" });
			}));
	});
});
