import { createBinaryLatch, delay } from "@aikirun/lib/async";
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
	runningTaskInfoFactory,
} from "@aikirun/testing/data-factory/workflow/task";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	ClientCodecDecodeFailedError,
	ClientCodecEncodeFailedError,
	ClientCodecMissingError,
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import { describe, expect, test, vi } from "vitest";

import type { ControlFlowError } from "./control-flow-error";
import { executeWorkflowRun } from "./workflow-run";
import { task } from "../../task";
import { workflow } from "../../workflow";
import type { AnyWorkflowVersion } from "../../workflow-version";
import type { EventsDefinition } from "../event";
import type { WorkflowRun } from "../index";

const configProvider = asConfigProvider(() => ({
	claimRefreshIntervalMs: 30_000,
	maxInlineWaitMs: 10,
}));

function fakeWorkflowVersion(
	handler: (run: Omit<WorkflowRun<unknown, EventsDefinition>, "context">, input: unknown) => Promise<void>
): AnyWorkflowVersion {
	return {
		name: "dummy-workflow" as WorkflowName,
		versionId: "1.0.0" as WorkflowVersionId,
		[INTERNAL]: { eventsDefinition: {}, handler },
	} as unknown as AnyWorkflowVersion;
}

describe("executeWorkflowRun", () => {
	describe("error classification", () => {
		// ClientCodecMissingError, ClientCodecEncodeFailedError, ClientCodecDecodeFailedError and
		// WorkflowRunStateUnknownError return false, and have their own tests below.
		const createControlFlowErrorByName: {
			[Member in Exclude<
				ControlFlowError,
				| ClientCodecMissingError
				| ClientCodecEncodeFailedError
				| ClientCodecDecodeFailedError
				| WorkflowRunStateUnknownError
			> as Member["name"]]: () => Member;
		} = {
			WorkflowRunNotExecutableError: () => new WorkflowRunNotExecutableError("run-1" as WorkflowRunId, "paused"),
			WorkflowRunSuspendedError: () => new WorkflowRunSuspendedError("run-1" as WorkflowRunId),
			WorkflowRunFailedError: () => new WorkflowRunFailedError("run-1" as WorkflowRunId, 1),
			WorkflowRunRevisionConflictError: () => new WorkflowRunRevisionConflictError("run-1" as WorkflowRunId),
			NonDeterminismError: () =>
				new NonDeterminismError("run-1" as WorkflowRunId, 1, { taskIds: [], childWorkflowRunIds: [] }),
		};

		for (const [name, createControlFlowError] of Object.entries(createControlFlowErrorByName)) {
			test(`returns true when the handler throws ${name}`, () =>
				withFakeClient(async (client) => {
					const workflowRun = runningWorkflowRunRecordFactory.build();
					const workflowVersion = fakeWorkflowVersion(async () => {
						throw createControlFlowError();
					});

					const result = await executeWorkflowRun({
						client,
						workflowRun,
						workflowVersion,
						logger: client.logger,
						configProvider,
					});

					expect(result).toBe(true);
				}));
		}

		test("returns false when the handler throws ClientCodecMissingError, so the run is redelivered", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new ClientCodecMissingError(workflowRun.id as WorkflowRunId);
				});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));

		test("returns false when the handler throws ClientCodecEncodeFailedError, so the run is redelivered", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new ClientCodecEncodeFailedError(new Error("Key 2025-06 not found"));
				});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));

		test("returns false when the handler throws ClientCodecDecodeFailedError, so the run is redelivered", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new ClientCodecDecodeFailedError(new Error("No codec named aes-v1"));
				});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));

		test("returns false without logging an error when the handler throws WorkflowRunStateUnknownError", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new WorkflowRunStateUnknownError(workflowRun.id as WorkflowRunId, new Error("fetch failed"));
				});
				const errorLog = vi.spyOn(client.logger, "error");

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
				expect(errorLog).not.toHaveBeenCalled();
			}));

		test("returns false and logs when the handler throws an unexpected error", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new Error("boom");
				});
				const errorLog = vi.spyOn(client.logger, "error");

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
				expect(errorLog).toHaveBeenCalled();
			}));

		test("returns true when the handler resolves", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(true);
			}));
	});

	describe("awaiting_task_retry", () => {
		test("a replayed task whose retry is not due transitions the run to awaiting_task_retry", () =>
			withFakeClient(async (client) => {
				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				const chargeCard = task<{ cardId: string }, string>({
					name: "charge-card",
					handler: async () => "charged",
					retry,
				});

				const input = { cardId: "card-1" };
				const inputHash = await hashInput(input);
				const address = getCompositeId({ name: chargeCard.name, referenceId: inputHash });
				// The clock cannot be pinned in unit tests (files run concurrently), so "not due"
				// is a deadline a day out — far beyond the lifetime of a test run.
				const nextAttemptAt = Date.now() + 24 * 60 * 60 * 1000;
				const awaitingRetryTaskInfo = awaitingRetryTaskInfoFactory.build({
					name: chargeCard.name,
					options: { retry },
					state: { nextAttemptAt },
				});
				const workflowRun = runningWorkflowRunRecordFactory.build({
					tasks: { [address]: [awaitingRetryTaskInfo] },
				});
				const workflowVersion = fakeWorkflowVersion(async (run) => {
					await chargeCard.start({ ...run, context: null }, input);
				});

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: workflowRun.id,
						state: { status: "awaiting_task_retry" },
						expectedRevision: workflowRun.revision,
					},
					{
						revision: workflowRun.revision + 1,
						state: { status: "awaiting_task_retry", nextAttemptAt },
						attempts: workflowRun.attempts,
					}
				);

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(true);
			}));
	});

	describe("a workflow handler that catches a task's error and starts a second task", () => {
		test("does not start the second task when the first task's completion gets no response, and leaves the run for recovery", () =>
			withFakeClient(async (client) => {
				const chargeCard = task({ name: "charge-card", handler: async () => "charged" });
				const refundCard = task({ name: "refund-card", handler: async () => "refunded" });
				const workflowVersion = workflow({ name: "checkout" }).v("1.0.0", {
					async handler(run) {
						try {
							await chargeCard.start(run);
						} catch {
							await refundCard.start(run);
						}
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const chargeCardTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: workflowRun.id,
						state: { status: "running" },
						expectedRevision: workflowRun.revision,
					},
					{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
				);
				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: undefined,
							inputHash: await hashInput(undefined),
							taskName: chargeCard.name,
							options: {},
							workflowRunId: workflowRun.id,
							expectedWorkflowRunRevision: workflowRun.revision,
							sequence: 1,
						},
						{ taskInfo: chargeCardTaskInfo }
					)
					.rejectsOnce(
						{
							id: chargeCardTaskInfo.id,
							attempts: 1,
							state: { status: "completed", output: asOpaquePayload("charged") },
							workflowRunId: workflowRun.id,
							expectedWorkflowRunRevision: workflowRun.revision,
							sequence: 2,
						},
						new Error("fetch failed")
					);

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));

		test("does not start the second task when the first task is awaiting a retry, and transitions the run to awaiting_task_retry", () =>
			withFakeClient(async (client) => {
				const retry = { type: "fixed", maxAttempts: 3, delayMs: 60_000 } as const;
				const chargeCard = task({
					name: "charge-card",
					handler: async () => {
						throw new Error("card network down");
					},
					retry,
				});
				const refundCard = task({ name: "refund-card", handler: async () => "refunded" });
				const workflowVersion = workflow({ name: "checkout" }).v("1.0.0", {
					async handler(run) {
						try {
							await chargeCard.start(run);
						} catch {
							await refundCard.start(run);
						}
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const chargeCardTaskInfo = runningTaskInfoFactory.build({ name: chargeCard.name });

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "running" },
							expectedRevision: workflowRun.revision,
						},
						{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "awaiting_task_retry" },
							expectedRevision: workflowRun.revision,
						},
						{
							revision: workflowRun.revision + 1,
							state: { status: "awaiting_task_retry", nextAttemptAt: 60_000 },
							attempts: workflowRun.attempts,
						}
					);
				client.api.task.transitionStateV1
					.once(
						{
							type: "create",
							input: undefined,
							inputHash: await hashInput(undefined),
							taskName: chargeCard.name,
							options: { retry },
							workflowRunId: workflowRun.id,
							expectedWorkflowRunRevision: workflowRun.revision,
							sequence: 1,
						},
						{ taskInfo: chargeCardTaskInfo }
					)
					.once(
						{
							id: chargeCardTaskInfo.id,
							attempts: 1,
							state: {
								status: "awaiting_retry",
								error: expect.objectContaining({ message: "card network down" }),
								nextAttemptInMs: 60_000,
							},
							workflowRunId: workflowRun.id,
							expectedWorkflowRunRevision: workflowRun.revision,
							sequence: 2,
						},
						{ taskInfo: chargeCardTaskInfo }
					);

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(true);
			}));

		test("does not start the second task when the client's codec cannot decode the first task's output, and leaves the run to be redelivered", () =>
			withFakeClient(async (client) => {
				// The charge's output was written by aes-v1, which the client's codec no longer has.
				client[INTERNAL].codec = {
					encode: async (payload) => payload,
					decode: async (encoded) => {
						if (encoded === "aes-v1:charged") {
							throw new Error("No codec named aes-v1");
						}
						return encoded;
					},
				};
				const chargeCard = task({ name: "charge-card", handler: async () => "charged" });
				const refundCard = task({ name: "refund-card", handler: async () => "refunded" });
				const workflowVersion = workflow({ name: "checkout" }).v("1.0.0", {
					async handler(run) {
						try {
							await chargeCard.start(run);
						} catch {
							await refundCard.start(run);
						}
					},
				});
				const chargeCardAddress = getCompositeId({ name: chargeCard.name, referenceId: await hashInput(undefined) });
				const workflowRun = runningWorkflowRunRecordFactory.build({
					clientCodecApplied: true,
					tasks: {
						[chargeCardAddress]: [
							completedTaskInfoFactory.build({
								name: chargeCard.name,
								state: { output: asOpaquePayload("aes-v1:charged") },
							}),
						],
					},
				});

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: workflowRun.id,
						state: { status: "running" },
						expectedRevision: workflowRun.revision,
					},
					{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
				);

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));

		test("does not start the second task when the client's codec cannot encode the first task's input, and leaves the run to be redelivered", () =>
			withFakeClient(async (client) => {
				client[INTERNAL].codec = {
					encode: async () => {
						throw new Error("Key 2025-06 not found");
					},
					decode: async (encoded) => encoded,
				};
				const chargeCard = task({ name: "charge-card", handler: async () => "charged" });
				const refundCard = task({ name: "refund-card", handler: async () => "refunded" });
				const workflowVersion = workflow({ name: "checkout" }).v("1.0.0", {
					async handler(run) {
						try {
							await chargeCard.start(run);
						} catch {
							await refundCard.start(run);
						}
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: workflowRun.id,
						state: { status: "running" },
						expectedRevision: workflowRun.revision,
					},
					{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
				);

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(result).toBe(false);
			}));
	});

	describe("context", () => {
		test("gives the handler a null context when the client has no context function", () =>
			withFakeClient(async (client) => {
				let contextSeenByHandler: unknown = "unset";
				const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
					async handler(run) {
						contextSeenByHandler = run.context;
						return "recorded";
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "running" },
							expectedRevision: workflowRun.revision,
						},
						{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							expectedRevision: workflowRun.revision,
						},
						{
							revision: workflowRun.revision,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							attempts: workflowRun.attempts,
						}
					);

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(contextSeenByHandler).toBeNull();
			}));

		test("gives the handler the context the client's context function returns", () =>
			withFakeClient({ context: () => ({ tenantId: "t1" }) }, async (client) => {
				let contextSeenByHandler: unknown;
				const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
					async handler(run) {
						contextSeenByHandler = run.context;
						return "recorded";
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "running" },
							expectedRevision: workflowRun.revision,
						},
						{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							expectedRevision: workflowRun.revision,
						},
						{
							revision: workflowRun.revision,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							attempts: workflowRun.attempts,
						}
					);

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(contextSeenByHandler).toEqual({ tenantId: "t1" });
			}));

		test("gives the handler the context an asynchronous context function resolves to", () =>
			withFakeClient({ context: async () => ({ tenantId: "t2" }) }, async (client) => {
				let contextSeenByHandler: unknown;
				const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
					async handler(run) {
						contextSeenByHandler = run.context;
						return "recorded";
					},
				});
				const workflowRun = runningWorkflowRunRecordFactory.build();

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "running" },
							expectedRevision: workflowRun.revision,
						},
						{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							expectedRevision: workflowRun.revision,
						},
						{
							revision: workflowRun.revision,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							attempts: workflowRun.attempts,
						}
					);

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(contextSeenByHandler).toEqual({ tenantId: "t2" });
			}));

		test("calls the context function with the run once it is running", () =>
			withFakeClient({ context: (run) => ({ status: run.state.status, revision: run.revision }) }, async (client) => {
				let contextSeenByHandler: unknown;
				const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
					async handler(run) {
						contextSeenByHandler = run.context;
						return "recorded";
					},
				});
				const workflowRun = { ...baseWorkflowRunRecordFactory.build(), state: workflowRunStateByStatus.queued };
				const queuedRevision = workflowRun.revision;
				const runningRevision = queuedRevision + 1;

				client.api.workflowRun.transitionStateV1
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "running" },
							expectedRevision: queuedRevision,
						},
						{ revision: runningRevision, state: { status: "running" }, attempts: workflowRun.attempts }
					)
					.once(
						{
							type: "optimistic",
							id: workflowRun.id,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							expectedRevision: runningRevision,
						},
						{
							revision: runningRevision + 1,
							state: { status: "completed", output: asOpaquePayload("recorded") },
							attempts: workflowRun.attempts,
						}
					);

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(contextSeenByHandler).toEqual({ status: "running", revision: runningRevision });
			}));

		test("fails the run when the context function throws", () =>
			withFakeClient(
				{
					context: () => {
						throw new Error("tenant lookup failed");
					},
				},
				async (client) => {
					const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
						async handler() {
							return "recorded";
						},
					});
					const workflowRun = runningWorkflowRunRecordFactory.build();

					client.api.workflowRun.transitionStateV1
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: { status: "running" },
								expectedRevision: workflowRun.revision,
							},
							{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
						)
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: {
									status: "failed",
									cause: "self",
									error: expect.objectContaining({ message: "tenant lookup failed", name: "Error" }),
								},
								expectedRevision: workflowRun.revision,
							},
							{
								revision: workflowRun.revision,
								state: { status: "failed", cause: "self", error: { name: "Error", message: "tenant lookup failed" } },
								attempts: workflowRun.attempts,
							}
						);

					const result = await executeWorkflowRun({
						client,
						workflowRun,
						workflowVersion,
						logger: client.logger,
						configProvider,
					});

					expect(result).toBe(true);
				}
			));

		test("fails the run when an asynchronous context function rejects", () =>
			withFakeClient(
				{
					context: async () => {
						throw new Error("tenant lookup failed");
					},
				},
				async (client) => {
					const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
						async handler() {
							return "recorded";
						},
					});
					const workflowRun = runningWorkflowRunRecordFactory.build();

					client.api.workflowRun.transitionStateV1
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: { status: "running" },
								expectedRevision: workflowRun.revision,
							},
							{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
						)
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: {
									status: "failed",
									cause: "self",
									error: expect.objectContaining({ message: "tenant lookup failed", name: "Error" }),
								},
								expectedRevision: workflowRun.revision,
							},
							{
								revision: workflowRun.revision,
								state: { status: "failed", cause: "self", error: { name: "Error", message: "tenant lookup failed" } },
								attempts: workflowRun.attempts,
							}
						);

					const result = await executeWorkflowRun({
						client,
						workflowRun,
						workflowVersion,
						logger: client.logger,
						configProvider,
					});

					expect(result).toBe(true);
				}
			));

		test("waits for a retry when the context function throws and the run has a retry left", () =>
			withFakeClient(
				{
					context: () => {
						throw new Error("tenant lookup failed");
					},
				},
				async (client) => {
					const workflowVersion = workflow({ name: "audit" }).v("1.0.0", {
						async handler() {
							return "recorded";
						},
						retry: { type: "fixed", maxAttempts: 5, delayMs: 1 },
					});
					const workflowRun = runningWorkflowRunRecordFactory.build();

					client.api.workflowRun.transitionStateV1
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: { status: "running" },
								expectedRevision: workflowRun.revision,
							},
							{ revision: workflowRun.revision, state: workflowRun.state, attempts: workflowRun.attempts }
						)
						.once(
							{
								type: "optimistic",
								id: workflowRun.id,
								state: {
									status: "awaiting_retry",
									cause: "self",
									nextAttemptInMs: 1,
									error: expect.objectContaining({ message: "tenant lookup failed", name: "Error" }),
								},
								expectedRevision: workflowRun.revision,
							},
							{
								revision: workflowRun.revision,
								state: {
									status: "awaiting_retry",
									cause: "self",
									nextAttemptAt: 0,
									error: { name: "Error", message: "tenant lookup failed" },
								},
								attempts: workflowRun.attempts,
							}
						);

					const result = await executeWorkflowRun({
						client,
						workflowRun,
						workflowVersion,
						logger: client.logger,
						configProvider,
					});

					expect(result).toBe(true);
				}
			));
	});

	test("invokes the handler with the run input decoded by the client's codec", () =>
		withFakeClient(async (client) => {
			const encodedInput = asOpaquePayload({ encoded: true });
			const decodedInput = { orderId: "o1" };
			client[INTERNAL].codec = {
				encode: async (payload) => payload,
				decode: async (payload) => {
					expect(payload).toEqual(encodedInput);
					return decodedInput;
				},
			};
			const workflowRun = runningWorkflowRunRecordFactory.build({ input: encodedInput, clientCodecApplied: true });
			let capturedInput: unknown;
			const workflowVersion = fakeWorkflowVersion(async (_run, input) => {
				capturedInput = input;
			});

			await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(capturedInput).toEqual(decodedInput);
		}));

	test("returns false when the run was recorded with the client codec applied but the client has none", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });
			let handlerCalled = false;
			const workflowVersion = fakeWorkflowVersion(async () => {
				handlerCalled = true;
			});

			const result = await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(result).toBe(false);
			expect(handlerCalled).toBe(false);
		}));

	test("returns false when the client's codec cannot decode the run's input", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => payload,
				decode: async () => {
					throw new Error("No codec named aes-v1");
				},
			};
			const workflowRun = runningWorkflowRunRecordFactory.build({
				input: asOpaquePayload("aes-v1:order-1"),
				clientCodecApplied: true,
			});
			let handlerCalled = false;
			const workflowVersion = fakeWorkflowVersion(async () => {
				handlerCalled = true;
			});

			const result = await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(result).toBe(false);
			expect(handlerCalled).toBe(false);
		}));

	test("hashes inside the run with the plain function when the run declares no client hasher, whatever the client holds", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].hasher = Object.assign(async () => ({ value: "client-hash" }), {
				for: async () => async () => "client-bound-hash",
			});
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientHasherApplied: false });
			const workflowVersion = fakeWorkflowVersion(async (run) => {
				expect(await run[INTERNAL].hasher({ orderId: "order-1" })).toBe(await hashInput({ orderId: "order-1" }));
			});

			expect(
				await executeWorkflowRun({ client, workflowRun, workflowVersion, logger: client.logger, configProvider })
			).toBe(true);
		}));

	test("hashes inside the run with the client's hasher under the rotation that produced the run's hash", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientHasherApplied: true });
			client[INTERNAL].hasher = Object.assign(async () => ({ value: "client-hash" }), {
				for: async (hash: string) => {
					expect(hash).toBe(workflowRun.inputHash);
					return async () => "client-bound-hash";
				},
			});
			const workflowVersion = fakeWorkflowVersion(async (run) => {
				expect(await run[INTERNAL].hasher({ orderId: "order-1" })).toBe("client-bound-hash");
			});

			expect(
				await executeWorkflowRun({ client, workflowRun, workflowVersion, logger: client.logger, configProvider })
			).toBe(true);
		}));

	test("returns false when the run declares a client hasher but the client has none", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientHasherApplied: true });
			let handlerCalled = false;
			const workflowVersion = fakeWorkflowVersion(async () => {
				handlerCalled = true;
			});

			const result = await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(result).toBe(false);
			expect(handlerCalled).toBe(false);
		}));

	test("returns false when the client's hasher cannot hash under the rotation that produced the run's hash", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientHasherApplied: true });
			let handlerCalled = false;
			const workflowVersion = fakeWorkflowVersion(async () => {
				handlerCalled = true;
			});
			client[INTERNAL].hasher = Object.assign(async () => ({ value: "unused" }), {
				for: async () => null,
			});

			const result = await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(result).toBe(false);
			expect(handlerCalled).toBe(false);
		}));

	describe("claim refresh", () => {
		test("keeps the claim alive by refreshing it while the handler runs", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const firstClaimRefresh = createBinaryLatch();
				client.api.workflowRun.claimRefreshV1.onNextCall(() => firstClaimRefresh.signal());
				client.api.workflowRun.claimRefreshV1.once({ id: workflowRun.id });

				// The handler blocks until the first claim refresh fires.
				const workflowVersion = fakeWorkflowVersion(async () => {
					await firstClaimRefresh.wait();
				});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider: asConfigProvider(() => ({
						...configProvider.config,
						claimRefreshIntervalMs: 10,
					})),
				});

				expect(result).toBe(true);
			}));

		test("stops refreshing the claim once the signal is aborted", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const controller = new AbortController();
				const handlerReleased = createBinaryLatch();
				const workflowVersion = fakeWorkflowVersion(async () => {
					await handlerReleased.wait();
				});

				controller.abort();

				const executionPromise = executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider: asConfigProvider(() => ({
						...configProvider.config,
						claimRefreshIntervalMs: 1,
					})),
					signal: controller.signal,
				});

				// Absence check: a 1ms claimRefreshIntervalMs would fire within this window had abort not torn it down.
				await delay(20);

				handlerReleased.signal();
				expect(await executionPromise).toBe(true);
			}));
	});

	describe("heartbeats", () => {
		test("fires the provided heartbeat on its configured interval", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				let heartbeatCalls = 0;
				const firstHeartbeat = createBinaryLatch();
				const sendHeartbeat = async () => {
					heartbeatCalls++;
					firstHeartbeat.signal();
				};
				// The handler blocks until the heartbeat has fired once.
				const workflowVersion = fakeWorkflowVersion(async () => {
					await firstHeartbeat.wait();
				});

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider: asConfigProvider(() => ({
						...configProvider.config,
						// Claim refresh is never fired because claimRefreshIntervalMs >> heartbeat.intervalMs
						claimRefreshIntervalMs: 30_000,
					})),
					heartbeat: { send: sendHeartbeat, intervalMs: 1 },
				});

				expect(result).toBe(true);
				expect(heartbeatCalls).toBeGreaterThanOrEqual(1);
			}));

		test("stops firing the heartbeat once the signal is aborted", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const controller = new AbortController();
				const handlerReleased = createBinaryLatch();
				const workflowVersion = fakeWorkflowVersion(async () => {
					await handlerReleased.wait();
				});
				let heartbeatCalls = 0;
				const sendHeartbeat = async () => {
					heartbeatCalls++;
				};

				controller.abort();

				const executionPromise = executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
					heartbeat: { send: sendHeartbeat, intervalMs: 1 },
					signal: controller.signal,
				});

				// Absence check: a 1ms heartbeat would fire within this window had abort not torn it down.
				await delay(20);
				expect(heartbeatCalls).toBe(0);

				handlerReleased.signal();
				expect(await executionPromise).toBe(true);
			}));
	});
});
