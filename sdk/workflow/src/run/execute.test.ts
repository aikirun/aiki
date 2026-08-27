import { createBinaryLatch, delay } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import type { Codec } from "@aikirun/types/infra/codec";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import type { EventsDefinition } from "./event";
import { executeWorkflowRun } from "./execute";
import type { WorkflowRun } from "./index";
import { describe, expect, spyOn, test } from "bun:test";
import type { AnyWorkflowVersion } from "../workflow-version";

const configProvider = asConfigProvider(() => ({
	claimRefreshIntervalMs: 30_000,
	maxInlineWaitMs: 10,
}));

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

	test("invokes the handler with the run input decoded by the client's codec", () =>
		withFakeClient(async (client) => {
			const encodedInput = { encodedValue: { encoded: true } };
			const decodedInput = { orderId: "o1" };
			client[INTERNAL].codec = {
				encode: async (payload) => ({ encodedValue: payload }),
				decode: async (payload) => {
					expect(payload).toEqual(encodedInput);
					return decodedInput;
				},
			};
			const workflowRun = runningWorkflowRunRecordFactory.build({ input: encodedInput, clientCodec: "applied" });
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

	test("passes the client's codec on the run", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ clientCodec: "applied" });
			let capturedCodec: unknown;
			const workflowVersion = fakeWorkflowVersion(async (run) => {
				capturedCodec = run[INTERNAL].codec;
			});

			await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(capturedCodec).toBe(client[INTERNAL].codec);
		}));

	test("uses the noop codec for system-sourced runs even when clientCodec is applied", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({
				source: "system",
				clientCodec: "applied",
			});
			let capturedCodec: Codec | undefined;
			const workflowVersion = fakeWorkflowVersion(async (run) => {
				capturedCodec = run[INTERNAL].codec;
			});

			await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(capturedCodec).toBeDefined();
			expect(capturedCodec).not.toBe(client[INTERNAL].codec);
			const payload = { value: 1 };
			expect(await capturedCodec?.encode(payload)).toEqual({ encodedValue: payload });
			expect(await capturedCodec?.decode({ encodedValue: payload })).toBe(payload);
		}));

	test("invokes the handler with the run source", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build({ source: "system" });
			let capturedSource: unknown;
			const workflowVersion = fakeWorkflowVersion(async (run) => {
				capturedSource = run.source;
			});

			await executeWorkflowRun({
				client,
				workflowRun,
				workflowVersion,
				logger: client.logger,
				configProvider,
			});

			expect(capturedSource).toBe("system");
		}));

	test("returns false when no hasher is bound for the run's input hash", () =>
		withFakeClient(async (client) => {
			const workflowRun = runningWorkflowRunRecordFactory.build();
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
