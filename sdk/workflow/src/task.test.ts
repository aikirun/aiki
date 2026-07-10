import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { getCompositeId } from "@aikirun/lib/id";
import { withFakeClient } from "@aikirun/testing/client";
import { baseWorkflowRunRecordFactory, runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import {
	completedTaskInfoFactory,
	failedTaskInfoFactory,
	runningTaskInfoFactory,
} from "@aikirun/testing/workflow/task";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type {
	WorkflowRunId,
	WorkflowRunRecord,
	WorkflowRunState,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WORKFLOW_RUN_STATUSES,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import { TaskFailedError } from "@aikirun/types/workflow/task";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRun } from "./run";
import { workflowRunHandle } from "./run/handle";
import { createReplayManifest } from "./run/replay-manifest";
import { task } from "./task";
import { describe, expect, test } from "bun:test";

function createTestWorkflowRun(
	client: Client,
	record: WorkflowRunRecord,
	options: { spinThresholdMs?: number } = {}
): WorkflowRun<unknown, null, Record<string, never>> {
	const handle = workflowRunHandle(client, record);
	return {
		id: record.id as WorkflowRunId,
		name: record.name as WorkflowName,
		versionId: record.versionId as WorkflowVersionId,
		options: record.options ?? {},
		logger: client.logger,
		sleep: () => {
			throw new Error("sleep is not used in task unit tests");
		},
		events: {},
		context: null,
		[INTERNAL]: {
			handle,
			replayManifest: createReplayManifest(record),
			configProvider: asConfigProvider(() => ({
				spinThresholdMs: options.spinThresholdMs ?? 10,
				heartbeatIntervalMs: 30_000,
			})),
		},
	};
}

const stateByStatus: { [Status in WorkflowRunStatus]: Extract<WorkflowRunState, { status: Status }> } = {
	scheduled: { status: "scheduled", scheduledAt: 0, reason: "new" },
	queued: { status: "queued", reason: "new" },
	running: { status: "running" },
	paused: { status: "paused" },
	sleeping: { status: "sleeping", sleepName: "nap", awakeAt: 0 },
	awaiting_event: { status: "awaiting_event", eventName: "order-shipped" },
	awaiting_retry: {
		status: "awaiting_retry",
		cause: "self",
		nextAttemptAt: 0,
		error: { name: "Error", message: "boom" },
	},
	awaiting_child_workflow: {
		status: "awaiting_child_workflow",
		childWorkflowRunId: "child-1",
		childWorkflowRunStatus: "completed",
	},
	cancelled: { status: "cancelled" },
	completed: { status: "completed", output: undefined },
	failed: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
};

describe("task", () => {
	describe("start", () => {
		for (const status of ["queued", "running"] as const) {
			test(`creates the task, then completes it with the handler output when the run is ${status}`, () =>
				withFakeClient(async (client) => {
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: stateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord);

					const sendEmail = task({
						name: "send-email",
						handler: async (to: string): Promise<string> => `Sent to ${to}`,
					});

					const input = "info@aiki.run";
					const output = "Sent to info@aiki.run";

					const runningTaskInfo = runningTaskInfoFactory.build({ name: sendEmail.name, state: { input } });
					const completedTaskInfo = completedTaskInfoFactory.build({
						id: runningTaskInfo.id,
						name: sendEmail.name,
						state: { output },
					});

					client.api.workflowRun.transitionTaskStateV1
						.once(
							{
								type: "create",
								taskName: sendEmail.name,
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
								taskState: completedTaskInfo.state,
								id: runRecord.id,
								expectedWorkflowRunRevision: runRecord.revision,
							},
							{ taskInfo: completedTaskInfo }
						);

					expect(await sendEmail.start(run, input)).toBe(output);
				}));
		}

		test("retries in-memory when the delay is within the spin threshold, recording no extra transition", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord, { spinThresholdMs: 10 });

				const retry = { type: "fixed", maxAttempts: 2, delayMs: 1 } as const;
				let handlerCalls = 0;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						handlerCalls++;
						if (handlerCalls === 1) {
							throw new Error("transient");
						}
						return "charged";
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const output = "charged";

				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name, state: { input } });
				const completedTaskInfo = completedTaskInfoFactory.build({
					id: runningTaskInfo.id,
					name: chargeCard.name,
					state: { attempts: 2, output },
				});

				client.api.workflowRun.transitionTaskStateV1
					.once(
						{
							type: "create",
							taskName: chargeCard.name,
							options: { retry },
							taskState: runningTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							taskId: runningTaskInfo.id,
							taskState: completedTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: completedTaskInfo }
					);

				expect(await chargeCard.start(run, input)).toBe(output);
				expect(handlerCalls).toBe(2);
			}));

		test("persists awaiting_retry and suspends when the delay exceeds the spin threshold", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord, { spinThresholdMs: 0 });

				const retry = { type: "fixed", maxAttempts: 2, delayMs: 1_000 } as const;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						throw new Error("down");
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name, state: { input } });

				client.api.workflowRun.transitionTaskStateV1
					.once(
						{
							type: "create",
							taskName: chargeCard.name,
							options: { retry },
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
								status: "awaiting_retry",
								attempts: 1,
								error: expect.objectContaining({ message: "down" }),
								nextAttemptInMs: 1_000,
							},
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					);

				let error: unknown;
				try {
					await chargeCard.start(run, input);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("fails the task and throws TaskFailedError when there is no retry budget", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord);

				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						throw new Error("declined");
					},
				});

				const input = { cardId: "card-1" };
				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name, state: { input } });

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

				let error: unknown;
				try {
					await chargeCard.start(run, input);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(TaskFailedError);
			}));

		test("replays a completed task from history without touching the client", () =>
			withFakeClient(async (client) => {
				let handlerCalls = 0;
				const sendEmail = task<{ to: string }, string>({
					name: "send-email",
					handler: async () => {
						handlerCalls++;
						return "freshly-sent";
					},
				});

				const input = { to: "info@aiki.run" };
				const output = "previously-sent";

				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: sendEmail.name, referenceId: inputHash });
				const recordedTask = completedTaskInfoFactory.build({ name: sendEmail.name, state: { output } });
				const runRecord = runningWorkflowRunRecordFactory.build({
					taskQueues: { [address]: { tasks: [recordedTask] } },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(await sendEmail.start(run, input)).toBe(output);
				expect(handlerCalls).toBe(0);
			}));

		test("returns the recorded output on replay without re-applying the output schema validation", () =>
			withFakeClient(async (client) => {
				const appendBang: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: (value) => ({ value: `${String(value)}!` }),
					},
				};
				let handlerCalls = 0;
				const sendEmail = task<{ to: string }, string>({
					name: "send-email",
					handler: async () => {
						handlerCalls++;
						return "freshly-sent";
					},
					schema: { output: appendBang },
				});

				const input = { to: "info@aiki.run" };
				const recordedOutput = "recorded!";

				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: sendEmail.name, referenceId: inputHash });
				const recordedTask = completedTaskInfoFactory.build({
					name: sendEmail.name,
					state: { output: recordedOutput },
				});
				const runRecord = runningWorkflowRunRecordFactory.build({
					taskQueues: { [address]: { tasks: [recordedTask] } },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(await sendEmail.start(run, input)).toBe(recordedOutput);
				expect(handlerCalls).toBe(0);
			}));

		test("fails the run and throws WorkflowRunFailedError when the input schema rejects", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord);

				const alwaysInvalid: StandardSchemaV1<string> = {
					"~standard": {
						version: 1,
						vendor: "test",
						validate: () => ({ issues: [{ message: "invalid input" }] }),
					},
				};
				const validateInput = task<string, string>({
					name: "validate-input",
					handler: async (value) => value,
					schema: { input: alwaysInvalid },
				});

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: expect.objectContaining({ status: "failed", cause: "self" }),
						expectedRevision: runRecord.revision,
					},
					{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
				);

				let error: unknown;
				try {
					await validateInput.start(run, "anything");
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(WorkflowRunFailedError);
			}));

		test("replays a failed task from history as TaskFailedError without touching the client", () =>
			withFakeClient(async (client) => {
				let handlerCalls = 0;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						handlerCalls++;
						return "charged";
					},
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: chargeCard.name, referenceId: inputHash });
				const failedTask = failedTaskInfoFactory.build({ name: chargeCard.name });
				const runRecord = runningWorkflowRunRecordFactory.build({
					taskQueues: { [address]: { tasks: [failedTask] } },
				});
				const run = createTestWorkflowRun(client, runRecord);

				let error: unknown;
				try {
					await chargeCard.start(run, input);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(TaskFailedError);
				expect(handlerCalls).toBe(0);
			}));

		test("fails the run with NonDeterminismError when the replay history diverges", () =>
			withFakeClient(async (client) => {
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => "charged",
				});

				const runRecord = runningWorkflowRunRecordFactory.build({
					taskQueues: { "other-task:other-hash": { tasks: [completedTaskInfoFactory.build()] } },
				});
				const run = createTestWorkflowRun(client, runRecord);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: expect.objectContaining({ status: "failed", cause: "self" }),
						expectedRevision: runRecord.revision,
					},
					{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
				);

				let error: unknown;
				try {
					await chargeCard.start(run, { cardId: "card-1" });
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(NonDeterminismError);
			}));

		for (const status of WORKFLOW_RUN_STATUSES) {
			if (status === "queued" || status === "running") {
				continue;
			}

			test(`throws WorkflowRunNotExecutableError when the run is ${status}`, () =>
				withFakeClient(async (client) => {
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: stateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord);

					let handlerCalls = 0;
					const sendEmail = task<{ to: string }, string>({
						name: "send-email",
						handler: async () => {
							handlerCalls++;
							return "sent";
						},
					});

					let error: unknown;
					try {
						await sendEmail.start(run, { to: "info@aiki.run" });
					} catch (caught) {
						error = caught;
					}
					expect(error).toBeInstanceOf(WorkflowRunNotExecutableError);
					expect(handlerCalls).toBe(0);
				}));
		}

		test("applies builder options to the create transition call", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord);

				const sendEmail = task<{ to: string }, string>({
					name: "send-email",
					handler: async () => "sent",
				});

				const input = { to: "info@aiki.run" };
				const output = "sent";
				const retry = { type: "fixed", maxAttempts: 3, delayMs: 1 } as const;

				const runningTaskInfo = runningTaskInfoFactory.build({ name: sendEmail.name, state: { input } });
				const completedTaskInfo = completedTaskInfoFactory.build({
					id: runningTaskInfo.id,
					name: sendEmail.name,
					state: { output },
				});

				client.api.workflowRun.transitionTaskStateV1
					.once(
						{
							type: "create",
							taskName: sendEmail.name,
							options: { retry },
							taskState: runningTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							taskId: runningTaskInfo.id,
							taskState: completedTaskInfo.state,
							id: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: completedTaskInfo }
					);

				expect(await sendEmail.with().opt("retry", retry).start(run, input)).toBe(output);
			}));
	});
});
