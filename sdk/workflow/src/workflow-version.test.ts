import { asConfigProvider } from "@aikirun/lib/config";
import { withFakeClient } from "@aikirun/testing/client";
import { pausedWorkflowRunRecordFactory, runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import { runningTaskInfoFactory } from "@aikirun/testing/workflow/task";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRun } from "./run";
import { workflowRunHandle } from "./run/handle";
import { createReplayManifest } from "./run/replay-manifest";
import { task } from "./task";
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
		test("uses the run's persisted strategy over the workflow definition strategy", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "error-workflow" }).v("1.0.0", {
					async handler() {
						throw new Error("boom");
					},
					retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
				});
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
				const workflowVersion = workflow({ name: "error-workflow" }).v("1.0.0", {
					async handler() {
						throw new Error("boom");
					},
					retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
				});
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
				const workflowVersion = workflow({ name: "error-workflow" }).v("1.0.0", {
					async handler() {
						throw new Error("boom");
					},
				});
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

	describe("successful execution", () => {
		test("completes the run and persists the handler output", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "completing-workflow" }).v("1.0.0", {
					async handler() {
						return "done";
					},
				});
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
							state: { status: "completed", output: "done" },
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "completed", output: "done" },
							attempts: runRecord.attempts,
						}
					);

				expect(await workflowVersion[INTERNAL].handler(run)).toBeUndefined();
			}));

		test("persists the schema-parsed value when an output schema is provided", () =>
			withFakeClient(async (client) => {
				const toUpperCase: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: (value) => ({ value: String(value).toUpperCase() }),
					},
				};
				const workflowVersion = workflow({ name: "validated-output-workflow" }).v("1.0.0", {
					async handler() {
						return "done";
					},
					schema: { output: toUpperCase },
				});
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
							state: { status: "completed", output: "DONE" },
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "completed", output: "DONE" },
							attempts: runRecord.attempts,
						}
					);

				expect(await workflowVersion[INTERNAL].handler(run)).toBeUndefined();
			}));

		test("fails without retrying when the output schema rejects, even with a retry strategy", () =>
			withFakeClient(async (client) => {
				const alwaysInvalid: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: () => ({ issues: [{ message: "invalid output" }] }),
					},
				};
				const workflowVersion = workflow({ name: "invalid-output-workflow" }).v("1.0.0", {
					async handler() {
						return "done";
					},
					schema: { output: alwaysInvalid },
					retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
				});
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
								error: expect.objectContaining({ name: "SchemaValidationError" }),
							},
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: {
								status: "failed",
								cause: "self",
								error: { name: "SchemaValidationError", message: JSON.stringify([{ message: "invalid output" }]) },
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
				expect(error).toBeInstanceOf(WorkflowRunFailedError);
			}));
	});

	describe("task failures", () => {
		test("fails with cause 'task' when retries are exhausted", () =>
			withFakeClient(async (client) => {
				const chargeCard = task({
					name: "charge-card",
					handler: async () => {
						throw new Error("declined");
					},
				});
				const workflowVersion = workflow({ name: "task-failing-workflow" }).v("1.0.0", {
					async handler(run) {
						await chargeCard.start(run);
					},
					retry: { type: "never" },
				});
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.workflowRun.transitionTaskStateV1
					.once(
						{
							type: "create",
							taskName: chargeCard.name,
							options: {},
							taskState: runningTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							taskId: runningTaskInfo.id,
							taskState: {
								status: "failed",
								attempts: 1,
								error: expect.objectContaining({ message: "declined" }),
							},
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					);

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
							state: { status: "failed", cause: "task", taskId: runningTaskInfo.id },
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "failed", cause: "task", taskId: runningTaskInfo.id },
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

		test("awaits retry with cause 'task' when retries remain", () =>
			withFakeClient(async (client) => {
				const chargeCard = task({
					name: "charge-card",
					handler: async () => {
						throw new Error("declined");
					},
				});
				const workflowVersion = workflow({ name: "task-retrying-workflow" }).v("1.0.0", {
					async handler(run) {
						await chargeCard.start(run);
					},
					retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
				});
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.workflowRun.transitionTaskStateV1
					.once(
						{
							type: "create",
							taskName: chargeCard.name,
							options: {},
							taskState: runningTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							taskId: runningTaskInfo.id,
							taskState: {
								status: "failed",
								attempts: 1,
								error: expect.objectContaining({ message: "declined" }),
							},
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					);

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
							state: { status: "awaiting_retry", cause: "task", nextAttemptInMs: 1, taskId: runningTaskInfo.id },
							expectedRevision: runRecord.revision,
						},
						{
							revision: runRecord.revision,
							state: { status: "awaiting_retry", cause: "task", nextAttemptAt: 0, taskId: runningTaskInfo.id },
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
	});

	describe("control-flow errors propagate unchanged", () => {
		const controlFlowErrorCases: Array<{ name: string; create: (id: WorkflowRunId, attempts: number) => Error }> = [
			{ name: "WorkflowRunSuspendedError", create: (id) => new WorkflowRunSuspendedError(id) },
			{ name: "WorkflowRunFailedError", create: (id, attempts) => new WorkflowRunFailedError(id, attempts) },
			{ name: "WorkflowRunRevisionConflictError", create: (id) => new WorkflowRunRevisionConflictError(id) },
			{
				name: "NonDeterminismError",
				create: (id, attempts) => new NonDeterminismError(id, attempts, { taskIds: [], childWorkflowRunIds: [] }),
			},
		];

		for (const errorCase of controlFlowErrorCases) {
			test(`rethrows ${errorCase.name} as-is without an additional state transition`, () =>
				withFakeClient(async (client) => {
					const runRecord = runningWorkflowRunRecordFactory.build();
					const thrownError = errorCase.create(runRecord.id as WorkflowRunId, runRecord.attempts);
					const workflowVersion = workflow({ name: "control-flow-workflow" }).v("1.0.0", {
						async handler() {
							throw thrownError;
						},
						retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
					});
					const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

					client.api.workflowRun.transitionStateV1.once(
						{
							type: "optimistic",
							id: runRecord.id,
							state: { status: "running" },
							expectedRevision: runRecord.revision,
						},
						{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
					);

					let error: unknown;
					try {
						await workflowVersion[INTERNAL].handler(run);
					} catch (caught) {
						error = caught;
					}
					expect(error).toBe(thrownError);
				}));
		}
	});

	describe("execution guard", () => {
		test("throws WorkflowRunNotExecutableError and performs no transition when the run is not executable", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "guarded-workflow" }).v("1.0.0", {
					async handler() {
						return "should not run";
					},
				});
				const runRecord = pausedWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

				let error: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunNotExecutableError);
			}));
	});
});
