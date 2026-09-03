import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { getCompositeId } from "@aikirun/lib/id";
import { withFakeClient } from "@aikirun/testing/client";
import {
	baseWorkflowRunRecordFactory,
	runningWorkflowRunRecordFactory,
	workflowRunStateByStatus,
} from "@aikirun/testing/data-factory/workflow/run";
import {
	awaitingRetryTaskInfoFactory,
	completedTaskInfoFactory,
	failedTaskInfoFactory,
	runningTaskInfoFactory,
} from "@aikirun/testing/data-factory/workflow/task";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
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
import { taskExecutionTracker } from "./run/task-execution-tracker";
import { type Task, task } from "./task";
import { describe, expect, expectTypeOf, test } from "bun:test";

function createTestWorkflowRun(
	client: Client,
	record: WorkflowRunRecord,
	options: { maxInlineWaitMs?: number } = {}
): WorkflowRun<null, Record<string, never>> {
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
			createTaskExecutionTracker: taskExecutionTracker(handle, client.logger).create,
			configProvider: asConfigProvider(() => ({
				claimRefreshIntervalMs: 30_000,
				maxInlineWaitMs: options.maxInlineWaitMs ?? 10,
			})),
			hasher: hashInput,
		},
	};
}

describe("task", () => {
	describe("start", () => {
		for (const status of ["queued", "running"] as const) {
			test(`creates the task, then completes it with the handler output when the run is ${status}`, () =>
				withFakeClient(async (client) => {
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: workflowRunStateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord);

					const sendEmail = task({
						name: "send-email",
						handler: async (to: string): Promise<string> => `Sent to ${to}`,
					});

					const input = "info@aiki.run";
					const inputHash = await hashInput(input);
					const output = "Sent to info@aiki.run";

					const runningTaskInfo = runningTaskInfoFactory.build({ name: sendEmail.name });
					const completedTaskInfo = completedTaskInfoFactory.build({
						id: runningTaskInfo.id,
						name: sendEmail.name,
						state: { output: asOpaquePayload(output) },
					});

					client.api.task.transitionStateV1
						.once(
							{
								type: "create",
								input: asOpaquePayload(input),
								inputHash,
								taskName: sendEmail.name,
								options: {},
								workflowRunId: runRecord.id,
								expectedWorkflowRunRevision: runRecord.revision,
							},
							{ taskInfo: runningTaskInfo }
						)
						.once(
							{
								id: runningTaskInfo.id,
								attempts: 1,
								state: completedTaskInfo.state,
								workflowRunId: runRecord.id,
								expectedWorkflowRunRevision: runRecord.revision,
							},
							{ taskInfo: completedTaskInfo }
						);

					expect(await sendEmail.start(run, input)).toBe(output);
				}));
		}

		test("encodes task input and output before sending them to the server", () =>
			withFakeClient(async (client) => {
				const input = "info@aiki.run";
				const output = "Sent to info@aiki.run";
				const encodedInput = asOpaquePayload({ encodedInput: true });
				const encodedOutput = asOpaquePayload({ encodedOutput: true });
				client[INTERNAL].codec = {
					encode: async (payload) => {
						if (payload === input) {
							return encodedInput;
						}
						if (payload === output) {
							return encodedOutput;
						}
						return payload;
					},
					decode: async (payload) => payload,
				};

				const runRecord = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });
				const run = createTestWorkflowRun(client, runRecord);

				const sendEmail = task({
					name: "send-email",
					handler: async (to: string): Promise<string> => `Sent to ${to}`,
				});

				const inputHash = await hashInput(input);
				const runningTaskInfo = runningTaskInfoFactory.build({ name: sendEmail.name });
				const completedTaskInfo = completedTaskInfoFactory.build({
					id: runningTaskInfo.id,
					name: sendEmail.name,
					state: { output: encodedOutput },
				});

				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: encodedInput,
							inputHash,
							taskName: sendEmail.name,
							options: {},
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							id: runningTaskInfo.id,
							attempts: 1,
							state: completedTaskInfo.state,
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: completedTaskInfo }
					);

				expect(await sendEmail.start(run, input)).toBe(output);
			}));

		test("retries in-memory when the delay is within the max inline wait, recording no extra transition", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord, { maxInlineWaitMs: 10 });

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
				const inputHash = await hashInput(input);
				const output = "charged";

				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });
				const completedTaskInfo = completedTaskInfoFactory.build({
					id: runningTaskInfo.id,
					name: chargeCard.name,
					attempts: 2,
					state: { output: asOpaquePayload(output) },
				});

				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: asOpaquePayload(input),
							inputHash,
							taskName: chargeCard.name,
							options: { retry },
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							id: runningTaskInfo.id,
							attempts: 2,
							state: completedTaskInfo.state,
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: completedTaskInfo }
					);

				expect(await chargeCard.start(run, input)).toBe(output);
				expect(handlerCalls).toBe(2);
			}));

		test("persists awaiting_retry and suspends when the delay exceeds the max inline wait", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();
				const run = createTestWorkflowRun(client, runRecord, { maxInlineWaitMs: 0 });

				const retry = { type: "fixed", maxAttempts: 2, delayMs: 1_000 } as const;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						throw new Error("down");
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: asOpaquePayload(input),
							inputHash,
							taskName: chargeCard.name,
							options: { retry },
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							id: runningTaskInfo.id,
							attempts: 1,
							state: {
								status: "awaiting_retry",
								error: expect.objectContaining({ message: "down" }),
								nextAttemptInMs: 1_000,
							},
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					);

				expect(chargeCard.start(run, input)).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("retries a due replayed task with the strategy from its stored options", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();

				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				let handlerCalls = 0;
				// The definition carries no retry; the stored options are what allow this retry.
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
				const awaitingRetryTaskInfo = awaitingRetryTaskInfoFactory.build({
					name: chargeCard.name,
					options: { retry },
					state: { nextAttemptAt: 1 },
				});
				const recordWithTask = { ...runRecord, tasks: { [address]: [awaitingRetryTaskInfo] } };
				const run = createTestWorkflowRun(client, recordWithTask);

				const retriedTaskInfo = runningTaskInfoFactory.build({
					id: awaitingRetryTaskInfo.id,
					name: chargeCard.name,
					attempts: 2,
				});
				client.api.task.transitionStateV1
					.once(
						{
							type: "retry",
							id: awaitingRetryTaskInfo.id,
							attempts: 2,
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: retriedTaskInfo }
					)
					.once(
						{
							id: awaitingRetryTaskInfo.id,
							attempts: 2,
							state: { status: "completed", output: asOpaquePayload("charged") },
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{
							taskInfo: completedTaskInfoFactory.build({
								id: awaitingRetryTaskInfo.id,
								name: chargeCard.name,
								attempts: 2,
								state: { output: asOpaquePayload("charged") },
							}),
						}
					);

				expect(await chargeCard.start(run, input)).toBe("charged");
				expect(handlerCalls).toBe(1);
			}));

		test("suspends without a request when a replayed task's retry is not due", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();

				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				let handlerCalls = 0;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						handlerCalls++;
						return "charged";
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: chargeCard.name, referenceId: inputHash });
				// The clock cannot be pinned in unit tests (files run concurrently), so "not due"
				// is a deadline a day out — far beyond the lifetime of a test run.
				const awaitingRetryTaskInfo = awaitingRetryTaskInfoFactory.build({
					name: chargeCard.name,
					options: { retry },
					state: { nextAttemptAt: Date.now() + 24 * 60 * 60 * 1000 },
				});
				const recordWithTask = { ...runRecord, tasks: { [address]: [awaitingRetryTaskInfo] } };
				const run = createTestWorkflowRun(client, recordWithTask, { maxInlineWaitMs: 0 });

				expect(chargeCard.start(run, input)).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
				expect(handlerCalls).toBe(0);
			}));

		test("retries in process when the remaining wait is within the max inline wait", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();

				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				let handlerCalls = 0;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						handlerCalls++;
						return "charged";
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: chargeCard.name, referenceId: inputHash });
				// The max inline wait admits every remaining wait, so the branch is decided by
				// configuration; the deadline sits a few milliseconds out only to keep the
				// in-process wait short.
				const awaitingRetryTaskInfo = awaitingRetryTaskInfoFactory.build({
					name: chargeCard.name,
					options: { retry },
					state: { nextAttemptAt: Date.now() + 5 },
				});
				const recordWithTask = { ...runRecord, tasks: { [address]: [awaitingRetryTaskInfo] } };
				const run = createTestWorkflowRun(client, recordWithTask, { maxInlineWaitMs: Number.MAX_SAFE_INTEGER });

				const retriedTaskInfo = runningTaskInfoFactory.build({
					id: awaitingRetryTaskInfo.id,
					name: chargeCard.name,
					attempts: 2,
				});
				client.api.task.transitionStateV1
					.once(
						{
							type: "retry",
							id: awaitingRetryTaskInfo.id,
							attempts: 2,
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: retriedTaskInfo }
					)
					.once(
						{
							id: awaitingRetryTaskInfo.id,
							attempts: 2,
							state: { status: "completed", output: asOpaquePayload("charged") },
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{
							taskInfo: completedTaskInfoFactory.build({
								id: awaitingRetryTaskInfo.id,
								name: chargeCard.name,
								attempts: 2,
								state: { output: asOpaquePayload("charged") },
							}),
						}
					);

				expect(await chargeCard.start(run, input)).toBe("charged");
				expect(handlerCalls).toBe(1);
			}));

		test("does not retry a replayed task whose stored options have no retry", () =>
			withFakeClient(async (client) => {
				const runRecord = runningWorkflowRunRecordFactory.build();

				// The definition carries a retry, but the stored options do not — the stored
				// options are the ones that count.
				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				let handlerCalls = 0;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => {
						handlerCalls++;
						return "charged";
					},
					retry,
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: chargeCard.name, referenceId: inputHash });
				const awaitingRetryTaskInfo = awaitingRetryTaskInfoFactory.build({ name: chargeCard.name });
				const recordWithTask = { ...runRecord, tasks: { [address]: [awaitingRetryTaskInfo] } };
				const run = createTestWorkflowRun(client, recordWithTask);

				expect(chargeCard.start(run, input)).rejects.toBeInstanceOf(TaskFailedError);
				expect(handlerCalls).toBe(0);
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
				const inputHash = await hashInput(input);
				const runningTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: asOpaquePayload(input),
							inputHash,
							taskName: chargeCard.name,
							options: {},
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							id: runningTaskInfo.id,
							attempts: 1,
							state: {
								status: "failed",
								error: expect.objectContaining({ message: "declined" }),
							},
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					);

				expect(chargeCard.start(run, input)).rejects.toBeInstanceOf(TaskFailedError);
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
				const recordedTask = completedTaskInfoFactory.build({
					name: sendEmail.name,
					state: { output: asOpaquePayload(output) },
				});
				const runRecord = runningWorkflowRunRecordFactory.build({
					tasks: { [address]: [recordedTask] },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(await sendEmail.start(run, input)).toBe(output);
				expect(handlerCalls).toBe(0);
			}));

		test("decodes recorded output when replaying a completed task", () =>
			withFakeClient(async (client) => {
				const encodedOutput = asOpaquePayload({ encoded: true });
				const decodedOutput = "previously-sent";
				client[INTERNAL].codec = {
					encode: async (payload) => payload,
					decode: async (payload) => {
						expect(payload).toEqual(encodedOutput);
						return decodedOutput;
					},
				};

				let handlerCalls = 0;
				const sendEmail = task<{ to: string }, string>({
					name: "send-email",
					handler: async () => {
						handlerCalls++;
						return "freshly-sent";
					},
				});

				const input = { to: "info@aiki.run" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: sendEmail.name, referenceId: inputHash });
				const recordedTask = completedTaskInfoFactory.build({
					name: sendEmail.name,
					state: { output: encodedOutput },
				});
				const runRecord = runningWorkflowRunRecordFactory.build({
					clientCodecApplied: true,
					tasks: { [address]: [recordedTask] },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(await sendEmail.start(run, input)).toBe(decodedOutput);
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
					state: { output: asOpaquePayload(recordedOutput) },
				});
				const runRecord = runningWorkflowRunRecordFactory.build({
					tasks: { [address]: [recordedTask] },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(await sendEmail.start(run, input)).toBe(recordedOutput);
				expect(handlerCalls).toBe(0);
			}));

		test("fails the run and throws WorkflowRunFailedError when the input schema rejects", () =>
			withFakeClient((client) => {
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

				expect(validateInput.start(run, "anything")).rejects.toBeInstanceOf(WorkflowRunFailedError);
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
					tasks: { [address]: [failedTask] },
				});
				const run = createTestWorkflowRun(client, runRecord);

				expect(chargeCard.start(run, input)).rejects.toBeInstanceOf(TaskFailedError);
				expect(handlerCalls).toBe(0);
			}));

		test("fails the run with NonDeterminismError when the replay history diverges", () =>
			withFakeClient((client) => {
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => "charged",
				});

				const runRecord = runningWorkflowRunRecordFactory.build({
					tasks: { "other-task:other-hash": [completedTaskInfoFactory.build()] },
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

				expect(chargeCard.start(run, { cardId: "card-1" })).rejects.toBeInstanceOf(NonDeterminismError);
			}));

		for (const status of WORKFLOW_RUN_STATUSES) {
			if (status === "queued" || status === "running") {
				continue;
			}

			test(`throws WorkflowRunNotExecutableError when the run is ${status}`, () =>
				withFakeClient((client) => {
					const runRecord = { ...baseWorkflowRunRecordFactory.build(), state: workflowRunStateByStatus[status] };
					const run = createTestWorkflowRun(client, runRecord);

					let handlerCalls = 0;
					const sendEmail = task<{ to: string }, string>({
						name: "send-email",
						handler: async () => {
							handlerCalls++;
							return "sent";
						},
					});

					expect(sendEmail.start(run, { to: "info@aiki.run" })).rejects.toBeInstanceOf(WorkflowRunNotExecutableError);
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
				const inputHash = await hashInput(input);
				const output = "sent";
				const retry = { type: "fixed", maxAttempts: 3, delayMs: 1 } as const;

				const runningTaskInfo = runningTaskInfoFactory.build({ name: sendEmail.name });
				const completedTaskInfo = completedTaskInfoFactory.build({
					id: runningTaskInfo.id,
					name: sendEmail.name,
					state: { output: asOpaquePayload(output) },
				});

				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: asOpaquePayload(input),
							inputHash,
							taskName: sendEmail.name,
							options: { retry },
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: runningTaskInfo }
					)
					.once(
						{
							id: runningTaskInfo.id,
							attempts: 1,
							state: completedTaskInfo.state,
							workflowRunId: runRecord.id,
							expectedWorkflowRunRevision: runRecord.revision,
						},
						{ taskInfo: completedTaskInfo }
					);

				expect(await sendEmail.with("retry", retry).start(run, input)).toBe(output);
			}));
	});
});

describe("task input/output serializability", () => {
	test("accepts an interface as output", () => {
		interface Receipt {
			id: string;
			total: number;
		}
		const charge = task({
			name: "charge",
			async handler() {
				const output: Receipt = { id: "r1", total: 5 };
				return output;
			},
		});
		expectTypeOf(charge).toEqualTypeOf<Task<void, Receipt>>();
	});

	test("rejects an output that cannot be stored", () => {
		// @ts-expect-error output.chargedAt is Date
		task({ name: "charge", handler: async () => ({ chargedAt: new Date() }) });
	});

	test("rejects an input that cannot be stored", () => {
		// @ts-expect-error input.since is Date
		task({ name: "charge", handler: async (input: { since: Date }) => input.since.toISOString() });
	});

	test("rejects an output typed any", () => {
		// @ts-expect-error output is any
		task({ name: "charge", handler: async () => JSON.parse("{}") });
	});
});
