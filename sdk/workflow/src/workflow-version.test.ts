import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { getCompositeId } from "@aikirun/lib/id";
import { withFakeClient } from "@aikirun/testing/client";
import {
	baseWorkflowRunRecordFactory,
	childWorkflowRunInfoFactory,
	pausedWorkflowRunRecordFactory,
	runningWorkflowRunRecordFactory,
	workflowRunStateByStatus,
} from "@aikirun/testing/workflow/run";
import { runningTaskInfoFactory } from "@aikirun/testing/workflow/task";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WORKFLOW_RUN_STATUSES,
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
			configProvider: asConfigProvider(() => ({ claimRefreshIntervalMs: 30_000, spinThresholdMs: 10 })),
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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunFailedError);
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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunSuspendedError);
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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunFailedError);
			}));
	});

	describe("successful execution", () => {
		for (const status of ["queued", "running"] as const) {
			test(`completes the run and persists the handler output when the run is ${status}`, () =>
				withFakeClient(async (client) => {
					const workflowVersion = workflow({ name: "completing-workflow" }).v("1.0.0", {
						async handler() {
							return "done";
						},
					});
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: workflowRunStateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

					client.api.workflowRun.transitionStateV1
						.once(
							{
								type: "optimistic",
								id: runRecord.id,
								state: { status: "running" },
								expectedRevision: runRecord.revision,
							},
							{ revision: runRecord.revision, state: { status: "running" }, attempts: runRecord.attempts }
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
		}

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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunFailedError);
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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunFailedError);
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

				let err: unknown;
				try {
					await workflowVersion[INTERNAL].handler(run);
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunSuspendedError);
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

					let err: unknown;
					try {
						await workflowVersion[INTERNAL].handler(run);
					} catch (caught) {
						err = caught;
					}
					expect(err).toBe(thrownError);
				}));
		}
	});

	describe("execution guard", () => {
		for (const status of WORKFLOW_RUN_STATUSES) {
			if (status === "queued" || status === "running") {
				continue;
			}

			test(`throws WorkflowRunNotExecutableError and performs no transition when the run is ${status}`, () =>
				withFakeClient(async (client) => {
					const workflowVersion = workflow({ name: "guarded-workflow" }).v("1.0.0", {
						async handler() {
							return "should not run";
						},
					});
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: workflowRunStateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<void, null, Record<string, never>>;

					let err: unknown;
					try {
						await workflowVersion[INTERNAL].handler(run);
					} catch (caught) {
						err = caught;
					}
					expect(err).toBeInstanceOf(WorkflowRunNotExecutableError);
				}));
		}
	});
});

describe("creating a workflow run", () => {
	describe("start", () => {
		test("creates the run with the given input and returns a handle to it", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return `Hello ${name}`;
					},
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{ name: "greet", versionId: "1.0.0", input: "world", options: {} },
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));

		test("forwards the schema-parsed value to createV1 when an input schema is provided", () =>
			withFakeClient(async (client) => {
				const toUpperCase: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: (value) => ({ value: String(value).toUpperCase() }),
					},
				};
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					schema: { input: toUpperCase },
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{ name: "greet", versionId: "1.0.0", input: "WORLD", options: {} },
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));

		test("throws SchemaValidationError and does not create a run when the input schema rejects", () =>
			withFakeClient(async (client) => {
				const alwaysInvalid: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: () => ({ issues: [{ message: "invalid input" }] }),
					},
				};
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					schema: { input: alwaysInvalid },
				});

				let err: unknown;
				try {
					await workflowVersion.start(client, "world");
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(SchemaValidationError);
			}));

		test("passes the definition retry strategy as start options", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					retry: { type: "fixed", maxAttempts: 3, delayMs: 100 },
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "greet",
						versionId: "1.0.0",
						input: "world",
						options: { retry: { type: "fixed", maxAttempts: 3, delayMs: 100 } },
					},
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));
	});

	describe("with", () => {
		test("overrides the definition start options via opt", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					retry: { type: "fixed", maxAttempts: 3, delayMs: 100 },
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{ name: "greet", versionId: "1.0.0", input: "world", options: { retry: { type: "never" } } },
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.with().opt("retry", { type: "never" }).start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));

		test("starts from the definition start options when no overrides are given", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					retry: { type: "fixed", maxAttempts: 3, delayMs: 100 },
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "greet",
						versionId: "1.0.0",
						input: "world",
						options: { retry: { type: "fixed", maxAttempts: 3, delayMs: 100 } },
					},
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.with().start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));

		test("merges opt overrides with the definition start options", () =>
			withFakeClient(async (client) => {
				const workflowVersion = workflow({ name: "greet" }).v("1.0.0", {
					async handler(_run, name: string) {
						return name;
					},
					retry: { type: "fixed", maxAttempts: 3, delayMs: 100 },
				});
				const newRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "greet",
						versionId: "1.0.0",
						input: "world",
						options: { retry: { type: "fixed", maxAttempts: 3, delayMs: 100 }, shard: "eu-west" },
					},
					{ id: newRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: newRunRecord.id }, { run: newRunRecord });

				const handle = await workflowVersion.with().opt("shard", "eu-west").start(client, "world");

				expect(handle.run.id).toBe(newRunRecord.id);
			}));
	});

	describe("startAsChild", () => {
		test("creates a child run linked to the parent and returns a handle to it", () =>
			withFakeClient(async (client) => {
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build();
				const parentRun = createTestWorkflowRun(client, parentRunRecord);
				const childRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "child-workflow",
						versionId: "1.0.0",
						input: "payload",
						parentWorkflowRunId: parentRunRecord.id,
						options: {},
					},
					{ id: childRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: childRunRecord.id }, { run: childRunRecord });

				const childHandle = await childWorkflow.startAsChild(parentRun, "payload");

				expect(childHandle.run.id).toBe(childRunRecord.id);
			}));

		test("propagates the parent's shard to the child run", () =>
			withFakeClient(async (client) => {
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build({ options: { shard: "eu-west" } });
				const parentRun = createTestWorkflowRun(client, parentRunRecord);
				const childRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "child-workflow",
						versionId: "1.0.0",
						input: "payload",
						parentWorkflowRunId: parentRunRecord.id,
						options: { shard: "eu-west" },
					},
					{ id: childRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: childRunRecord.id }, { run: childRunRecord });

				const childHandle = await childWorkflow.startAsChild(parentRun, "payload");

				expect(childHandle.run.id).toBe(childRunRecord.id);
			}));

		test("returns the recorded child run on replay without creating a new one", () =>
			withFakeClient(async (client) => {
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
				});

				const inputHash = await hashInput("payload");
				const address = getCompositeId({
					name: childWorkflow.name,
					versionId: childWorkflow.versionId,
					referenceId: inputHash,
				});
				const recordedChildRun = childWorkflowRunInfoFactory.build({
					name: childWorkflow.name,
					versionId: childWorkflow.versionId,
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: { [address]: { childWorkflowRuns: [recordedChildRun] } },
				});
				const parentRun = createTestWorkflowRun(client, parentRunRecord);

				client.api.workflowRun.getByIdV1.once(
					{ id: recordedChildRun.id },
					{ run: runningWorkflowRunRecordFactory.build({ id: recordedChildRun.id }) }
				);

				const childHandle = await childWorkflow.startAsChild(parentRun, "payload");

				expect(childHandle.run.id).toBe(recordedChildRun.id);
			}));

		test("fails the parent with a non-determinism error when no recorded child matches", () =>
			withFakeClient(async (client) => {
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
				});

				const mismatchedAddress = getCompositeId({
					name: childWorkflow.name,
					versionId: childWorkflow.versionId,
					referenceId: "different-input-hash",
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: {
						[mismatchedAddress]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build()] },
					},
				});
				const parentRun = createTestWorkflowRun(client, parentRunRecord);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRunRecord.id,
						state: {
							status: "failed",
							cause: "self",
							error: expect.objectContaining({ name: "NonDeterminismError" }),
						},
						expectedRevision: parentRunRecord.revision,
					},
					{
						revision: parentRunRecord.revision,
						state: { status: "failed", cause: "self", error: { name: "NonDeterminismError", message: "divergence" } },
						attempts: parentRunRecord.attempts,
					}
				);

				let err: unknown;
				try {
					await childWorkflow.startAsChild(parentRun, "payload");
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(NonDeterminismError);
			}));

		test("throws WorkflowRunNotExecutableError when the parent is not executable", () =>
			withFakeClient(async (client) => {
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
				});
				const parentRun = createTestWorkflowRun(client, pausedWorkflowRunRecordFactory.build());

				let err: unknown;
				try {
					await childWorkflow.startAsChild(parentRun, "payload");
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunNotExecutableError);
			}));

		test("forwards the schema-parsed input to createV1", () =>
			withFakeClient(async (client) => {
				const toUpperCase: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: (value) => ({ value: String(value).toUpperCase() }),
					},
				};
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
					schema: { input: toUpperCase },
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build();
				const parentRun = createTestWorkflowRun(client, parentRunRecord);
				const childRunRecord = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.createV1.once(
					{
						name: "child-workflow",
						versionId: "1.0.0",
						input: "PAYLOAD",
						parentWorkflowRunId: parentRunRecord.id,
						options: {},
					},
					{ id: childRunRecord.id }
				);
				client.api.workflowRun.getByIdV1.once({ id: childRunRecord.id }, { run: childRunRecord });

				const childHandle = await childWorkflow.startAsChild(parentRun, "payload");

				expect(childHandle.run.id).toBe(childRunRecord.id);
			}));

		test("fails the parent when the input schema rejects", () =>
			withFakeClient(async (client) => {
				const alwaysInvalid: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: () => ({ issues: [{ message: "invalid input" }] }),
					},
				};
				const childWorkflow = workflow({ name: "child-workflow" }).v("1.0.0", {
					async handler(_run, payload: string) {
						return payload;
					},
					schema: { input: alwaysInvalid },
				});
				const parentRunRecord = runningWorkflowRunRecordFactory.build();
				const parentRun = createTestWorkflowRun(client, parentRunRecord);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRunRecord.id,
						state: {
							status: "failed",
							cause: "self",
							error: expect.objectContaining({ name: "SchemaValidationError" }),
						},
						expectedRevision: parentRunRecord.revision,
					},
					{
						revision: parentRunRecord.revision,
						state: {
							status: "failed",
							cause: "self",
							error: { name: "SchemaValidationError", message: JSON.stringify([{ message: "invalid input" }]) },
						},
						attempts: parentRunRecord.attempts,
					}
				);

				let err: unknown;
				try {
					await childWorkflow.startAsChild(parentRun, "payload");
				} catch (caught) {
					err = caught;
				}
				expect(err).toBeInstanceOf(WorkflowRunFailedError);
			}));
	});
});

describe("getting a run handle", () => {
	test("getHandleById returns a handle to the run fetched by id", () =>
		withFakeClient(async (client) => {
			const workflowVersion = workflow({ name: "orders" }).v("1.0.0", {
				async handler() {},
			});
			const runRecord = runningWorkflowRunRecordFactory.build();

			client.api.workflowRun.getByIdV1.once({ id: runRecord.id }, { run: runRecord });

			const handle = await workflowVersion.getHandleById(client, runRecord.id);

			expect(handle.run.id).toBe(runRecord.id);
		}));

	test("getHandleByReferenceId looks the run up by the workflow name, version, and reference id", () =>
		withFakeClient(async (client) => {
			const workflowVersion = workflow({ name: "orders" }).v("1.0.0", {
				async handler() {},
			});
			const runRecord = runningWorkflowRunRecordFactory.build();

			client.api.workflowRun.getByReferenceIdV1.once(
				{ name: "orders", versionId: "1.0.0", referenceId: "order-42" },
				{ run: runRecord }
			);

			const handle = await workflowVersion.getHandleByReferenceId(client, "order-42");

			expect(handle.run.id).toBe(runRecord.id);
		}));
});
