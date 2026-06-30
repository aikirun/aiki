import { asConfigProvider } from "@aikirun/lib/config";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import { WorkflowRunFailedError, WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import type { WorkflowRun } from "./run";
import { workflowRunHandle } from "./run/handle";
import { createReplayManifest } from "./run/replay-manifest";
import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

function createTestWorkflowRun(
	client: Client,
	record: WorkflowRunRecord
): WorkflowRun<unknown, null, Record<string, never>> {
	const handle = workflowRunHandle(client, record);
	return {
		id: record.id as WorkflowRunId,
		name: record.name as WorkflowName,
		versionId: record.versionId as WorkflowVersionId,
		options: record.options ?? {},
		logger: client.logger,
		sleep: () => {
			throw new Error("sleep is not used in these unit tests");
		},
		events: {},
		context: null,
		[INTERNAL]: {
			handle,
			replayManifest: createReplayManifest(record),
			configProvider: asConfigProvider(() => ({ heartbeatIntervalMs: 30_000, spinThresholdMs: 10 })),
		},
	};
}

describe("workflow version execution", () => {
	describe("retry strategy precedence", () => {
		function createErrorWorkflow(retry?: RetryStrategy) {
			return workflow({ name: "error-workflow" }).v("1.0.0", {
				async handler() {
					throw new Error("boom");
				},
				retry,
			});
		}

		test("uses the run's persisted strategy over the workflow definition strategy", () =>
			withFakeClient(async (client) => {
				const workflowVersion = createErrorWorkflow({ type: "fixed", maxAttempts: 5, delayMs: 1 });
				const runRecord = runningWorkflowRunRecordFactory.build({ options: { retry: { type: "never" } } });
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: { status: "running" },
							expectedRevision: runRecord.revision,
						},
						{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: {
								status: "failed",
								cause: "self",
								error: expect.objectContaining({ message: "boom", name: "Error" }),
							},
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
							attempts: runRecord.attempts,
						}
					);

				let error: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunFailedError);
			}));

		test("falls back to the workflow definition retry strategy when the run has none", () =>
			withFakeClient(async (client) => {
				const workflowVersion = createErrorWorkflow({ type: "fixed", maxAttempts: 5, delayMs: 1 });
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: { status: "running" },
							expectedRevision: runRecord.revision,
						},
						{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: {
								status: "awaiting_retry",
								cause: "self",
								nextAttemptInMs: 1,
								error: expect.objectContaining({ message: "boom", name: "Error" }),
							},
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: {
								status: "awaiting_retry",
								cause: "self",
								nextAttemptAt: 0,
								error: { name: "Error", message: "boom" },
							},
							attempts: runRecord.attempts,
						}
					);

				let error: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("falls back to no retries when neither the run nor the workflow defines a strategy", () =>
			withFakeClient(async (client) => {
				const workflowVersion = createErrorWorkflow();
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: { status: "running" },
							expectedRevision: runRecord.revision,
						},
						{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: {
								status: "failed",
								cause: "self",
								error: expect.objectContaining({ message: "boom", name: "Error" }),
							},
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
							attempts: runRecord.attempts,
						}
					);

				let error: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunFailedError);
			}));
	});
});
