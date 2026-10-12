import type { DurationObject } from "@aikirun/lib/duration";
import type { FakeClient } from "@aikirun/testing/client";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	WorkflowRunFailedError,
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { workflowRunHandle } from "./handle";
import { createSleeper } from "./sleeper";

function createTestSleeper(client: Omit<FakeClient, "verify">, record: WorkflowRunRecord) {
	return createSleeper(workflowRunHandle(client, record), client.logger);
}

describe("createSleeper", () => {
	describe("first encounter", () => {
		test("transitions the run to sleeping and suspends", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					{ revision: 1, state: { status: "sleeping", sleepName: "nap", wakeupAt: 0 }, attempts: 1 }
				);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("propagates a non-conflict transition error without suspending", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);
				const nonConflictError = { code: "BAD_REQUEST", status: 400 };

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					nonConflictError
				);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBe(nonConflictError);
			}));
	});

	describe("replay", () => {
		test("suspends again without a transition when the recorded sleep is still sleeping", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: { nap: [{ status: "sleeping", wakeupAt: 0 }] },
				});
				const sleep = createTestSleeper(client, record);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("returns cancelled when the recorded sleep was cancelled", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: { nap: [{ status: "cancelled", cancelledAt: 0 }] },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
			}));

		test("returns not-cancelled when the recorded sleep completed at the same duration", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: { nap: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: false });
			}));

		test("returns not-cancelled without sleeping again when the replay duration is shorter", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: { nap: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 30 })).toEqual({ cancelled: false });
			}));

		test("sleeps for the remaining duration when the replay duration is longer", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					revision: 4,
					sleeps: { nap: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] },
				});
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 30_000 },
						expectedRevision: 4,
					},
					{ revision: 5, state: { status: "sleeping", sleepName: "nap", wakeupAt: 0 }, attempts: 1 }
				);

				await expect(sleep("nap", { seconds: 90 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));
	});

	describe("cursor", () => {
		test("advances the per-name cursor across calls", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: {
						nap: [
							{ status: "completed", durationMs: 60_000, completedAt: 0 },
							{ status: "cancelled", cancelledAt: 1 },
						],
					},
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: false });
				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
			}));

		test("tracks a separate cursor per sleep name", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleeps: {
						nap: [{ status: "cancelled", cancelledAt: 0 }],
						bath: [{ status: "completed", durationMs: 60_000, completedAt: 1 }],
					},
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
				expect(await sleep("bath", { seconds: 60 })).toEqual({ cancelled: false });
			}));
	});

	describe("ending the execution", () => {
		test("ends the execution when the sleep request gets no response", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const handle = workflowRunHandle(client, record);
				const sleep = createSleeper(handle, client.logger);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					new Error("fetch failed")
				);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunStateUnknownError);

				expect(() => handle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunStateUnknownError);
			}));

		test("ends the execution when the run changed before the sleep was recorded", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const handle = workflowRunHandle(client, record);
				const sleep = createSleeper(handle, client.logger);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunRevisionConflictError);

				expect(() => handle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunRevisionConflictError);
			}));

		test("refuses to sleep once the execution has ended", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build();
				const handle = workflowRunHandle(client, record);
				const sleep = createSleeper(handle, client.logger);

				const suspension = new WorkflowRunSuspendedError(record.id as WorkflowRunId);
				await expect(handle[INTERNAL].executeIfAllowed(() => Promise.reject(suspension))).rejects.toBe(suspension);

				await expect(sleep("nap", { seconds: 60 })).rejects.toBe(suspension);
			}));
	});

	describe("duration limits", () => {
		test("sleeps for exactly ten years", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 315_360_000_000 },
						expectedRevision: 0,
					},
					{ revision: 1, state: { status: "sleeping", sleepName: "nap", wakeupAt: 0 }, attempts: 1 }
				);

				await expect(sleep("nap", { days: 3650 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		const invalidDurations: Record<string, { duration: DurationObject; reason: string }> = {
			"longer than ten years": {
				duration: { days: 3651 },
				reason: "Sleep duration 315446400000ms exceeds maximum of 10 years",
			},
			zero: { duration: { seconds: 0 }, reason: "Sleep duration must be greater than zero" },
			"a fraction of a millisecond": {
				duration: { milliseconds: 0.5 },
				reason: "Sleep duration 0.5ms is not a whole number of milliseconds",
			},
			negative: { duration: { hours: -1 }, reason: "'hours' duration must be non-negative. Received: -1" },
			"not a number": {
				duration: { seconds: Number.NaN },
				reason: "'seconds' duration must be finite. Received: NaN",
			},
			infinite: {
				duration: { days: Number.POSITIVE_INFINITY },
				reason: "'days' duration must be finite. Received: Infinity",
			},
		};

		for (const [situation, { duration, reason }] of Object.entries(invalidDurations)) {
			test(`fails the run when the duration is ${situation}`, () =>
				withFakeClient(async (client) => {
					const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
					const sleep = createTestSleeper(client, record);
					const failedState = {
						status: "failed" as const,
						cause: "self" as const,
						error: { name: "InvalidSleepDurationError", message: reason },
					};

					client.api.workflowRun.transitionStateV1.once(
						{ type: "optimistic", id: record.id, state: failedState, expectedRevision: 0 },
						{ revision: 1, state: failedState, attempts: 1 }
					);

					await expect(sleep("nap", duration)).rejects.toBeInstanceOf(WorkflowRunFailedError);
				}));
		}
	});
});
