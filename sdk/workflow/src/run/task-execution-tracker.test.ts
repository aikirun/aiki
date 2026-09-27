import { delay } from "@aikirun/lib/async";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import { INTERNAL } from "@aikirun/types/symbols";

import { workflowRunHandle } from "./handle";
import { taskExecutionTracker } from "./task-execution-tracker";
import { describe, expect, test } from "bun:test";

describe("taskExecutionTracker", () => {
	test("flush waits for open task executions even when none awaited a retry", () =>
		withFakeClient(async (client) => {
			const handle = workflowRunHandle(client, runningWorkflowRunRecordFactory.build());
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const tracker = createTracker();

			let flushed = false;
			const flushing = flush().then(() => {
				flushed = true;
			});
			await delay(5);
			expect(flushed).toBe(false);

			tracker.end();

			await flushing;
			expect(flushed).toBe(true);
		}));

	test("flush does nothing when no task execution awaited a retry", () =>
		withFakeClient(async (client) => {
			const handle = workflowRunHandle(client, runningWorkflowRunRecordFactory.build());
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const tracker = createTracker();
			tracker.end();

			expect(flush()).resolves.toBeUndefined();
		}));

	test("flush transitions the run only after every task execution ends", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 3, attempts: 1 });
			const handle = workflowRunHandle(client, record);
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const awaitingRetryExecution = createTracker();
			awaitingRetryExecution.awaitingRetry();
			awaitingRetryExecution.end();
			const openExecution = createTracker();

			client.api.workflowRun.transitionStateV1.once(
				{ type: "optimistic", id: record.id, state: { status: "awaiting_task_retry" }, expectedRevision: 3 },
				{ revision: 4, state: { status: "awaiting_task_retry", nextAttemptAt: 1 }, attempts: 1 }
			);
			let transitioned = false;
			client.api.workflowRun.transitionStateV1.onNextCall(() => {
				transitioned = true;
			});

			const flushing = flush();
			await delay(5);
			expect(transitioned).toBe(false);

			openExecution.end();
			await flushing;
			expect(transitioned).toBe(true);

			expect(handle.run.state).toEqual({ status: "awaiting_task_retry", nextAttemptAt: 1 });
		}));

	test("flush skips the awaiting_retry transition when the run is no longer running", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 3, attempts: 1 });
			const handle = workflowRunHandle(client, record);
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const tracker = createTracker();
			tracker.awaitingRetry();
			tracker.end();

			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
					expectedRevision: 3,
				},
				{ revision: 4, state: { status: "sleeping", sleepName: "nap", wakeupAt: 60_001 }, attempts: 1 }
			);
			await handle[INTERNAL].transitionState({ status: "sleeping", sleepName: "nap", durationMs: 60_000 });

			await flush();

			expect(handle.run.state).toEqual({ status: "sleeping", sleepName: "nap", wakeupAt: 60_001 });
		}));

	test("flush resolves even when the transition fails", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 3 });
			const handle = workflowRunHandle(client, record);
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const tracker = createTracker();
			tracker.awaitingRetry();
			tracker.end();

			client.api.workflowRun.transitionStateV1.rejectsOnce(
				{ type: "optimistic", id: record.id, state: { status: "awaiting_task_retry" }, expectedRevision: 3 },
				{ code: "SOME_OTHER_ERROR" }
			);

			expect(flush()).resolves.toBeUndefined();
		}));

	test("flush resolves even when the transition hits a revision conflict", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 3 });
			const handle = workflowRunHandle(client, record);
			const { create: createTracker, flush } = taskExecutionTracker(handle, client.logger);

			const tracker = createTracker();
			tracker.awaitingRetry();
			tracker.end();

			client.api.workflowRun.transitionStateV1.rejectsOnce(
				{ type: "optimistic", id: record.id, state: { status: "awaiting_task_retry" }, expectedRevision: 3 },
				{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
			);

			expect(flush()).resolves.toBeUndefined();
		}));
});
