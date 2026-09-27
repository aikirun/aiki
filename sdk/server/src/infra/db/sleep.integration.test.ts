import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../../testing/harness";
import { seedClaimedRun, seedSleepingRun } from "../../testing/seed/run";

const withHarness = createServiceHarness();

function orderByName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name);
}

describe("sleep repository create", () => {
	test("rejects a second sleeping sleep for a run", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, wakeupAt } = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);

			expect(
				repos.sleep.create({
					id: "01-second-sleep",
					workflowRunId: runId,
					name: "warmup",
					status: "sleeping",
					wakeupAt: (wakeupAt + 1) as TimestampMs,
				})
			).rejects.toThrow();
			expect(await repos.sleep.listByWorkflowRunId(runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ workflowRunId: runId, name: "cooldown", status: "sleeping", wakeupAt }),
			]);
		}));
});

describe("sleep repository listByWorkflowRunId", () => {
	test("lists the run's sleeps in id order, leaving out other runs' sleeps", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			await repos.sleep.create({
				id: "02-cancelled-sleep",
				workflowRunId: runId,
				name: "warmup",
				status: "cancelled",
				wakeupAt: 1_000_000 as TimestampMs,
				cancelledAt: 2_000_000 as TimestampMs,
			});
			await repos.sleep.create({
				id: "01-completed-sleep",
				workflowRunId: runId,
				name: "cooldown",
				status: "completed",
				wakeupAt: 1_000_000 as TimestampMs,
				completedAt: 3_000_000 as TimestampMs,
			});

			expect(await repos.sleep.listByWorkflowRunId(runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ id: "01-completed-sleep", workflowRunId: runId, status: "completed" }),
				expect.objectContaining({ id: "02-cancelled-sleep", workflowRunId: runId, status: "cancelled" }),
			]);
		}));
});

describe("sleep repository update", () => {
	test("completes a sleep at the given instant", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await repos.sleep.create({
				id: "01-cooldown",
				workflowRunId: runId,
				name: "cooldown",
				status: "sleeping",
				wakeupAt: 1_000_000 as TimestampMs,
			});
			const completedAt = 2_000_000 as TimestampMs;

			await repos.sleep.update("01-cooldown", { status: "completed", completedAt });

			expect(await repos.sleep.listByWorkflowRunId(runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ id: "01-cooldown", status: "completed", completedAt, cancelledAt: null }),
			]);
		}));

	test("cancels a sleep at the given instant", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await repos.sleep.create({
				id: "01-cooldown",
				workflowRunId: runId,
				name: "cooldown",
				status: "sleeping",
				wakeupAt: 1_000_000 as TimestampMs,
			});
			const cancelledAt = 2_000_000 as TimestampMs;

			await repos.sleep.update("01-cooldown", { status: "cancelled", cancelledAt });

			expect(await repos.sleep.listByWorkflowRunId(runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ id: "01-cooldown", status: "cancelled", cancelledAt, completedAt: null }),
			]);
		}));
});

describe("sleep repository bulkCompleteByWorkflowRunIds", () => {
	test("completes the sleeping sleep of each given run and leaves finalized sleeps and other runs' sleeps untouched", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const sleepingRun = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			await repos.sleep.create({
				id: "01-warmup-cancelled",
				workflowRunId: sleepingRun.runId,
				name: "warmup",
				status: "cancelled",
				wakeupAt: 1_000_000 as TimestampMs,
				cancelledAt: 2_000_000 as TimestampMs,
			});
			await repos.sleep.create({
				id: "02-stretch-completed",
				workflowRunId: sleepingRun.runId,
				name: "stretch",
				status: "completed",
				wakeupAt: 1_000_000 as TimestampMs,
				completedAt: 2_000_000 as TimestampMs,
			});
			const otherSleepingRun = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			const completedAt = 3_000_000 as TimestampMs;

			await repos.sleep.bulkCompleteByWorkflowRunIds([sleepingRun.runId], completedAt);

			const sleepingRunSleeps = await repos.sleep.listByWorkflowRunId(sleepingRun.runId as WorkflowRunId);
			expect([...sleepingRunSleeps].sort(orderByName)).toEqual([
				expect.objectContaining({ name: "cooldown", status: "completed", completedAt, cancelledAt: null }),
				expect.objectContaining({
					id: "02-stretch-completed",
					name: "stretch",
					status: "completed",
					completedAt: 2_000_000,
					cancelledAt: null,
				}),
				expect.objectContaining({
					id: "01-warmup-cancelled",
					name: "warmup",
					status: "cancelled",
					cancelledAt: 2_000_000,
					completedAt: null,
				}),
			]);
			expect(await repos.sleep.listByWorkflowRunId(otherSleepingRun.runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ name: "cooldown", status: "sleeping", completedAt: null, cancelledAt: null }),
			]);
		}));
});

describe("sleep repository bulkCancelByWorkflowRunIds", () => {
	test("cancels the sleeping sleep of each given run and leaves finalized sleeps and other runs' sleeps untouched", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const sleepingRun = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			await repos.sleep.create({
				id: "01-warmup-cancelled",
				workflowRunId: sleepingRun.runId,
				name: "warmup",
				status: "cancelled",
				wakeupAt: 1_000_000 as TimestampMs,
				cancelledAt: 2_000_000 as TimestampMs,
			});
			await repos.sleep.create({
				id: "02-stretch-completed",
				workflowRunId: sleepingRun.runId,
				name: "stretch",
				status: "completed",
				wakeupAt: 1_000_000 as TimestampMs,
				completedAt: 2_000_000 as TimestampMs,
			});
			const otherSleepingRun = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			const cancelledAt = 3_000_000 as TimestampMs;

			await repos.sleep.bulkCancelByWorkflowRunIds([sleepingRun.runId], cancelledAt);

			const sleepingRunSleeps = await repos.sleep.listByWorkflowRunId(sleepingRun.runId as WorkflowRunId);
			expect([...sleepingRunSleeps].sort(orderByName)).toEqual([
				expect.objectContaining({ name: "cooldown", status: "cancelled", cancelledAt, completedAt: null }),
				expect.objectContaining({
					id: "02-stretch-completed",
					name: "stretch",
					status: "completed",
					completedAt: 2_000_000,
					cancelledAt: null,
				}),
				expect.objectContaining({
					id: "01-warmup-cancelled",
					name: "warmup",
					status: "cancelled",
					cancelledAt: 2_000_000,
					completedAt: null,
				}),
			]);
			expect(await repos.sleep.listByWorkflowRunId(otherSleepingRun.runId as WorkflowRunId)).toEqual([
				expect.objectContaining({ name: "cooldown", status: "sleeping", completedAt: null, cancelledAt: null }),
			]);
		}));
});

describe("sleep repository getActiveByWorkflowRunIdAndName", () => {
	test("returns the run's sleeping sleep by name, never a finalized sleep, and null for an unknown name", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, wakeupAt } = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			await repos.sleep.create({
				id: "01-cooldown-cancelled",
				workflowRunId: runId,
				name: "cooldown",
				status: "cancelled",
				wakeupAt: 1_000_000 as TimestampMs,
				cancelledAt: 2_000_000 as TimestampMs,
			});
			await repos.sleep.create({
				id: "02-warmup-completed",
				workflowRunId: runId,
				name: "warmup",
				status: "completed",
				wakeupAt: 1_000_000 as TimestampMs,
				completedAt: 2_000_000 as TimestampMs,
			});

			expect(await repos.sleep.getActiveByWorkflowRunIdAndName(runId as WorkflowRunId, "cooldown")).toEqual(
				expect.objectContaining({ workflowRunId: runId, name: "cooldown", status: "sleeping", wakeupAt })
			);
			expect(await repos.sleep.getActiveByWorkflowRunIdAndName(runId as WorkflowRunId, "warmup")).toBeNull();
			expect(await repos.sleep.getActiveByWorkflowRunIdAndName(runId as WorkflowRunId, "no-such-sleep")).toBeNull();
		}));
});
