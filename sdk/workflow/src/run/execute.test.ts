import { asConfigProvider } from "@aikirun/lib/config";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	CLAIM_KEEPALIVE_INTERVAL_MS,
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import type { EventsDefinition } from "./event";
import { executeWorkflowRun } from "./execute";
import type { WorkflowRun } from "./index";
import { describe, expect, jest, spyOn, test } from "bun:test";
import type { AnyWorkflowVersion } from "../workflow-version";

const configProvider = asConfigProvider(() => ({ heartbeatIntervalMs: 30_000, spinThresholdMs: 10 }));

function fakeWorkflowVersion(
	handler: (run: WorkflowRun<unknown, unknown, EventsDefinition>, input: unknown) => Promise<void>
): AnyWorkflowVersion {
	return {
		name: "dummy-workflow" as WorkflowName,
		versionId: "1.0.0" as WorkflowVersionId,
		[INTERNAL]: { eventsDefinition: {}, handler },
	} as unknown as AnyWorkflowVersion;
}

describe("executeWorkflowRun", () => {
	describe("error classification", () => {
		const controlFlowErrors: Array<{ name: string; make: () => Error }> = [
			{
				name: "WorkflowRunNotExecutableError",
				make: () => new WorkflowRunNotExecutableError("run-1" as WorkflowRunId, "paused"),
			},
			{ name: "WorkflowRunSuspendedError", make: () => new WorkflowRunSuspendedError("run-1" as WorkflowRunId) },
			{ name: "WorkflowRunFailedError", make: () => new WorkflowRunFailedError("run-1" as WorkflowRunId, 1) },
			{
				name: "WorkflowRunRevisionConflictError",
				make: () => new WorkflowRunRevisionConflictError("run-1" as WorkflowRunId),
			},
			{
				name: "NonDeterminismError",
				make: () => new NonDeterminismError("run-1" as WorkflowRunId, 1, { taskIds: [], childWorkflowRunIds: [] }),
			},
		];

		for (const errorCase of controlFlowErrors) {
			test(`returns true when the handler throws ${errorCase.name}`, () =>
				withFakeClient(async (client) => {
					const workflowRun = runningWorkflowRunRecordFactory.build();
					const workflowVersion = fakeWorkflowVersion(async () => {
						throw errorCase.make();
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

		test("returns false and logs when the handler throws an unexpected error", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				const workflowVersion = fakeWorkflowVersion(async () => {
					throw new Error("boom");
				});
				const errorLog = spyOn(client.logger, "error");

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

	describe("context", () => {
		test("passes null context when the client has no context factory", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				let capturedContext: unknown = "unset";
				const workflowVersion = fakeWorkflowVersion(async (run) => {
					capturedContext = run.context;
				});

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(capturedContext).toBeNull();
			}));

		test("resolves a synchronous context factory", () =>
			withFakeClient({ context: () => ({ tenantId: "t1" }) }, async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				let capturedContext: unknown;
				const workflowVersion = fakeWorkflowVersion(async (run) => {
					capturedContext = run.context;
				});

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(capturedContext).toEqual({ tenantId: "t1" });
			}));

		test("awaits an asynchronous context factory", () =>
			withFakeClient({ context: async () => ({ tenantId: "t2" }) }, async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				let capturedContext: unknown;
				const workflowVersion = fakeWorkflowVersion(async (run) => {
					capturedContext = run.context;
				});

				await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider,
				});

				expect(capturedContext).toEqual({ tenantId: "t2" });
			}));
	});

	test("invokes the handler with the run input", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ input: { orderId: "o1" } });
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

			expect(capturedInput).toEqual({ orderId: "o1" });
		}));

	describe("heartbeats", () => {
		test("keeps the claim alive by heartbeating while the handler runs", () =>
			withFakeClient(async (client) => {
				jest.useFakeTimers();
				try {
					const workflowRun = runningWorkflowRunRecordFactory.build();
					let release = () => {};
					const blocked = new Promise<void>((resolve) => {
						release = resolve;
					});
					const workflowVersion = fakeWorkflowVersion(async () => {
						await blocked;
					});
					client.api.workflowRun.heartbeatV1.once({ id: workflowRun.id });

					const runPromise = executeWorkflowRun({
						client,
						workflowRun,
						workflowVersion,
						logger: client.logger,
						configProvider,
					});

					jest.advanceTimersByTime(CLAIM_KEEPALIVE_INTERVAL_MS);
					expect(client.api.workflowRun.heartbeatV1).toHaveBeenCalledWith({ id: workflowRun.id });

					release();
					expect(await runPromise).toBe(true);
				} finally {
					jest.useRealTimers();
				}
			}));

		test("fires the provided heartbeat on its configured interval", () =>
			withFakeClient(async (client) => {
				const workflowRun = runningWorkflowRunRecordFactory.build();
				let heartbeatCalls = 0;
				let resolveFirstHeartbeat = () => {};
				const firstHeartbeat = new Promise<void>((resolve) => {
					resolveFirstHeartbeat = resolve;
				});
				const heartbeat = async () => {
					heartbeatCalls++;
					resolveFirstHeartbeat();
				};
				// The handler blocks until the heartbeat has fired once.
				const workflowVersion = fakeWorkflowVersion(async () => {
					await firstHeartbeat;
				});
				const config = asConfigProvider(() => ({ heartbeatIntervalMs: 1, spinThresholdMs: 10 }));

				const result = await executeWorkflowRun({
					client,
					workflowRun,
					workflowVersion,
					logger: client.logger,
					configProvider: config,
					heartbeat,
				});

				expect(result).toBe(true);
				expect(heartbeatCalls).toBeGreaterThanOrEqual(1);
			}));
	});
});
