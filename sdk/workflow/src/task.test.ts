import { getTaskAddress } from "@aikirun/lib/address";
import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { fakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import { completedTaskInfoFactory, runningTaskInfoFactory } from "@aikirun/testing/workflow/task";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";
import { TaskFailedError } from "@aikirun/types/workflow/task";

import type { WorkflowRun } from "./run";
import { workflowRunHandle } from "./run/handle";
import { createReplayManifest } from "./run/replay-manifest";
import { task } from "./task";
import { describe, expect, test } from "bun:test";

function createTestWorkflowRun(
	client: Client,
	record: WorkflowRunRecord,
	options: { spinThresholdMs?: number } = {}
): WorkflowRun<unknown, null> {
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

describe("task", () => {
	describe("start", () => {
		test("creates the task, then completes it with the handler output", async () => {
			using client = fakeClient();
			const runRecord = runningWorkflowRunRecordFactory.build();
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
		});

		test("retries in-memory when the delay is within the spin threshold, recording no extra transition", async () => {
			using client = fakeClient();
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
				options: { retry },
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
		});

		test("persists awaiting_retry and suspends when the delay exceeds the spin threshold", async () => {
			using client = fakeClient();
			const runRecord = runningWorkflowRunRecordFactory.build();
			const run = createTestWorkflowRun(client, runRecord, { spinThresholdMs: 0 });

			const retry = { type: "fixed", maxAttempts: 2, delayMs: 1_000 } as const;
			const chargeCard = task<{ cardId: string }, string>({
				name: "charge-card",
				handler: async () => {
					throw new Error("down");
				},
				options: { retry },
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
		});

		test("fails the task and throws TaskFailedError when there is no retry budget", async () => {
			using client = fakeClient();
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
		});

		test("replays a completed task from history without touching the client", async () => {
			using client = fakeClient();

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
			const address = getTaskAddress(sendEmail.name, inputHash);
			const recordedTask = completedTaskInfoFactory.build({ name: sendEmail.name, state: { output } });
			const runRecord = runningWorkflowRunRecordFactory.build({
				taskQueues: { [address]: { tasks: [recordedTask] } },
			});
			const run = createTestWorkflowRun(client, runRecord);

			expect(await sendEmail.start(run, input)).toBe(output);
			expect(handlerCalls).toBe(0);
		});
	});
});
