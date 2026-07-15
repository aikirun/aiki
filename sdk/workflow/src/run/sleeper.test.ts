import type { FakeClient } from "@aikirun/testing/client";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import type { WorkflowRunRecord } from "@aikirun/types/workflow/run";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import { workflowRunHandle } from "./handle";
import { createSleeper } from "./sleeper";
import { describe, expect, test } from "bun:test";

function createTestSleeper(client: Omit<FakeClient, "verify">, record: WorkflowRunRecord) {
	return createSleeper(workflowRunHandle(client, record), client.logger);
}

describe("createSleeper", () => {
	describe("first encounter", () => {
		test("transitions the run to sleeping and suspends", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					{ revision: 1, state: { status: "sleeping", sleepName: "nap", awakeAt: 0 }, attempts: 1 }
				);

				expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("maps a revision conflict on the sleep transition to a suspension", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("propagates a non-conflict transition error without suspending", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const sleep = createTestSleeper(client, record);
				const nonConflictError = { code: "SOME_OTHER_ERROR" };

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
						expectedRevision: 0,
					},
					nonConflictError
				);

				expect(sleep("nap", { seconds: 60 })).rejects.toBe(nonConflictError);
			}));
	});

	describe("replay", () => {
		test("suspends again without a transition when the recorded sleep is still sleeping", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: { nap: { sleeps: [{ status: "sleeping", awakeAt: 0 }] } },
				});
				const sleep = createTestSleeper(client, record);

				expect(sleep("nap", { seconds: 60 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("returns cancelled when the recorded sleep was cancelled", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: { nap: { sleeps: [{ status: "cancelled", cancelledAt: 0 }] } },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
			}));

		test("returns not-cancelled when the recorded sleep completed at the same duration", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: { nap: { sleeps: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] } },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: false });
			}));

		test("returns not-cancelled without sleeping again when the replay duration is shorter", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: { nap: { sleeps: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] } },
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 30 })).toEqual({ cancelled: false });
			}));

		test("sleeps for the remaining duration when the replay duration is longer", () =>
			withFakeClient((client) => {
				const record = runningWorkflowRunRecordFactory.build({
					revision: 4,
					sleepQueues: { nap: { sleeps: [{ status: "completed", durationMs: 60_000, completedAt: 0 }] } },
				});
				const sleep = createTestSleeper(client, record);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: record.id,
						state: { status: "sleeping", sleepName: "nap", durationMs: 30_000 },
						expectedRevision: 4,
					},
					{ revision: 5, state: { status: "sleeping", sleepName: "nap", awakeAt: 0 }, attempts: 1 }
				);

				expect(sleep("nap", { seconds: 90 })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));
	});

	describe("cursor", () => {
		test("advances the per-name cursor across calls", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: {
						nap: {
							sleeps: [
								{ status: "completed", durationMs: 60_000, completedAt: 0 },
								{ status: "cancelled", cancelledAt: 1 },
							],
						},
					},
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: false });
				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
			}));

		test("tracks a separate cursor per sleep name", () =>
			withFakeClient(async (client) => {
				const record = runningWorkflowRunRecordFactory.build({
					sleepQueues: {
						nap: { sleeps: [{ status: "cancelled", cancelledAt: 0 }] },
						bath: { sleeps: [{ status: "completed", durationMs: 60_000, completedAt: 1 }] },
					},
				});
				const sleep = createTestSleeper(client, record);

				expect(await sleep("nap", { seconds: 60 })).toEqual({ cancelled: true });
				expect(await sleep("bath", { seconds: 60 })).toEqual({ cancelled: false });
			}));
	});

	test("throws when the duration exceeds the maximum", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const sleep = createTestSleeper(client, record);

			expect(sleep("nap", { days: 3651 })).rejects.toThrow(/exceeds maximum/);
		}));
});
