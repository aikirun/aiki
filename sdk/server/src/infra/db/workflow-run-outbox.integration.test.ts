import { createBinaryLatch } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";

import type { WorkflowRunOutboxRowInsert } from "./types/workflow-run-outbox";
import { describe, expect, test } from "bun:test";
import { withFakeClock } from "../../testing/clock";
import { pendingWorkflowRunOutboxRowFactory } from "../../testing/data-factory/infra/workflow-run-outbox";
import { namespaceRequestContextFactory } from "../../testing/data-factory/middleware/context";
import { createDaemonHarness, withRepos } from "../../testing/harness";
import { seedQueuedRun } from "../../testing/run-seed";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

describe("leaseDuePending — lease", () => {
	test("selects the most-due rows when more are due than the limit", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				// rank and nextPublishAttemptRank deliberately diverge: ordering by rank would pick dueLast first.
				const dueFirst = pendingWorkflowRunOutboxRowFactory.build({ rank: 30, nextPublishAttemptRank: 10 });
				const dueSecond = pendingWorkflowRunOutboxRowFactory.build({ rank: 20, nextPublishAttemptRank: 20 });
				const dueLast = pendingWorkflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 30 });
				await repos.workflowRunOutbox.createBatch([dueFirst, dueSecond, dueLast]);

				const leasedRows = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 5_000, limit: 2 });

				expect(leasedRows.map((row) => row.id).sort()).toEqual([dueFirst.id, dueSecond.id].sort());
			});
		}));

	test("leases a row at the due cutoff and skips one scheduled beyond it", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const beyondCutoffRow = pendingWorkflowRunOutboxRowFactory.build({ nextPublishAttemptRank: 10_000_010 });
				const atCutoffRow = pendingWorkflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 10_000_009 });
				await repos.workflowRunOutbox.createBatch([beyondCutoffRow, atCutoffRow]);

				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 5_000, limit: 100 });

				expect(leased).toEqual([expect.objectContaining({ id: atCutoffRow.id })]);
			});
		}));

	test("pushes a leased chunk past the due prefix", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const row = pendingWorkflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 1 });
				await repos.workflowRunOutbox.createBatch([row]);

				const firstLease = await repos.workflowRunOutbox.leaseDuePending(context, {
					leaseDurationMs: 5_000,
					limit: 100,
				});
				expect(firstLease).toEqual([expect.objectContaining({ id: row.id })]);

				const secondLease = await repos.workflowRunOutbox.leaseDuePending(context, {
					leaseDurationMs: 5_000,
					limit: 100,
				});
				expect(secondLease).toEqual([]);
			});
		}));

	test("preserves the row's priority digit in the lease rank", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				// rank 15 carries priority digit 5.
				const row = pendingWorkflowRunOutboxRowFactory.build({ rank: 15, nextPublishAttemptRank: 15 });
				await repos.workflowRunOutbox.createBatch([row]);

				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 3_000, limit: 100 });
				expect(leased).toEqual([expect.objectContaining({ id: row.id })]);

				const leasedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				});
				// computeRank(now + leaseDurationMs, 5) = (1_000_000 + 3_000) * 10 + 5.
				expect(leasedRow).toEqual(expect.objectContaining({ nextPublishAttemptRank: 10_030_005 }));
			});
		}));
});

describe("claim-path ignores nextPublishAttemptRank", () => {
	test("a backed-off pending row is invisible to the delivery lease but visible to claimPending", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId, outboxRowId, workflowSource, workflowName, workflowVersionId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				// Back the row off beyond the due cutoff computeRank(now) = 10_000_009, as a
				// deferred/failed outcome would.
				await repos.workflowRunOutbox.setNextPublishAttemptRank([
					{ id: outboxRowId, nextPublishAttemptRank: 20_000_000 },
				]);

				const deliveryLease = await repos.workflowRunOutbox.leaseDuePending(context, {
					leaseDurationMs: 5_000,
					limit: 100,
				});
				expect(deliveryLease).toEqual([]);

				const workerClaim = await repos.workflowRunOutbox.claimPending(
					namespaceRequestContext.namespaceId,
					{ workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }] },
					100
				);
				expect(workerClaim).toEqual([expect.objectContaining({ workflowRunId: runId })]);
			});
		}));
});

describe("claimPending — workflow source", () => {
	test("claims only the row matching the requested source when name and versionId collide", () =>
		withHarness(async ({ repos }) => {
			const workflowName = "reconcile-ledger";
			const workflowVersionId = "v3";

			const collidingRowFactory = pendingWorkflowRunOutboxRowFactory.associations({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowName,
				workflowVersionId,
			});
			const userRow = collidingRowFactory.build({ workflowSource: "user" });
			const systemRow = collidingRowFactory.build({ workflowSource: "system" });
			await repos.workflowRunOutbox.createBatch([userRow, systemRow]);

			const systemClaim = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{ workflows: [{ source: "system", name: workflowName, versionId: workflowVersionId }] },
				100
			);
			expect(systemClaim).toEqual([{ workflowRunId: systemRow.workflowRunId }]);

			const userClaim = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{ workflows: [{ source: "user", name: workflowName, versionId: workflowVersionId }] },
				100
			);
			expect(userClaim).toEqual([{ workflowRunId: userRow.workflowRunId }]);
		}));
});

describe("setNextPublishAttemptRank — pending-only guard", () => {
	test("leaves a worker-claimed row untouched", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { outboxRowId, runId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				await repos.workflowRunOutbox.markClaimed(namespaceRequestContext.namespaceId, runId);

				await repos.workflowRunOutbox.setNextPublishAttemptRank([
					{ id: outboxRowId, nextPublishAttemptRank: 20_000_000 },
				]);

				const claimedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				expect(claimedRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "claimed", nextPublishAttemptRank: 10_000_009 })
				);
			});
		}));
});

describe("returnToPending — delivery schedule reset", () => {
	test("resets nextPublishAttemptRank to rank so the row is immediately due", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { outboxRowId, runId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				// Push the schedule beyond the cutoff so the reset back to rank is visible.
				await repos.workflowRunOutbox.setNextPublishAttemptRank([
					{ id: outboxRowId, nextPublishAttemptRank: 20_000_000 },
				]);
				await repos.workflowRunOutbox.markClaimed(namespaceRequestContext.namespaceId, runId);

				const claimedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				expect(claimedRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "claimed", nextPublishAttemptRank: 20_000_000 })
				);

				await repos.workflowRunOutbox.returnToPending([outboxRowId], "claimed");

				const restoredRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				expect(restoredRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "pending", nextPublishAttemptRank: 10_000_009 })
				);

				// The restored rank sits exactly at the due cutoff, so the delivery lease takes it.
				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 5_000, limit: 100 });
				expect(leased).toEqual([expect.objectContaining({ id: outboxRowId })]);
			});
		}));
});

describe("claimPending — concurrent worker claims are disjoint", () => {
	test("two concurrent worker claims together cover all seeded rows with no overlap", () =>
		withHarness(async ({ repos: primaryRepos }) =>
			withRepos(async (secondaryRepos) => {
				const workflowSource = "user";
				const workflowName = "sync-inventory";
				const workflowVersionId = "v1";

				const workflowRunOutboxRowFactory = pendingWorkflowRunOutboxRowFactory.associations({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowSource,
					workflowName,
					workflowVersionId,
				});

				const seededOutboxRows: NonEmptyArray<WorkflowRunOutboxRowInsert> = [
					workflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 1 }),
					workflowRunOutboxRowFactory.build({ rank: 2, nextPublishAttemptRank: 2 }),
					workflowRunOutboxRowFactory.build({ rank: 3, nextPublishAttemptRank: 3 }),
				];
				await primaryRepos.workflowRunOutbox.createBatch(seededOutboxRows);

				const primaryChunkClaimed = createBinaryLatch();
				const commitPrimaryTx = createBinaryLatch();

				// Transaction A claims a strict subset, then stays open (uncommitted) holding its
				// row locks until released.
				const primaryChunkPromise = primaryRepos.transaction(async (txRepos) => {
					const claimedRows = await txRepos.workflowRunOutbox.claimPending(
						namespaceRequestContext.namespaceId,
						{ workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }] },
						2
					);
					primaryChunkClaimed.signal();
					await commitPrimaryTx.wait();
					return claimedRows;
				});
				await primaryChunkClaimed.wait();

				// Connection B tries to claim everything while A is still open (not awaited yet).
				const secondaryChunkPromise = secondaryRepos.workflowRunOutbox.claimPending(
					namespaceRequestContext.namespaceId,
					{ workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }] },
					100
				);

				commitPrimaryTx.signal();
				const primaryClaimedRows = await primaryChunkPromise;
				const secondaryClaimedRows = await secondaryChunkPromise;

				const primaryRunIds = primaryClaimedRows.map((row) => row.workflowRunId);
				const secondaryRunIds = secondaryClaimedRows.map((row) => row.workflowRunId);
				const overlap = primaryRunIds.filter((runId) => secondaryRunIds.includes(runId));
				expect(overlap).toEqual([]);

				expect([...primaryRunIds, ...secondaryRunIds].sort()).toEqual(
					seededOutboxRows.map((row) => row.workflowRunId).sort()
				);
			})
		));
});

describe("leaseDuePending — concurrent delivery leases are disjoint", () => {
	test("two concurrent delivery leases together cover all seeded due rows with no overlap", () =>
		withHarness(async ({ context, repos: primaryRepos }) =>
			withRepos(async (secondaryRepos) => {
				const now = 1_000_000;
				await withFakeClock(now, async () => {
					const seededOutboxRows: NonEmptyArray<WorkflowRunOutboxRowInsert> = [
						pendingWorkflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 1 }),
						pendingWorkflowRunOutboxRowFactory.build({ rank: 2, nextPublishAttemptRank: 2 }),
						pendingWorkflowRunOutboxRowFactory.build({ rank: 3, nextPublishAttemptRank: 3 }),
					];
					await primaryRepos.workflowRunOutbox.createBatch(seededOutboxRows);

					const primaryChunkLeased = createBinaryLatch();
					const commitPrimaryTx = createBinaryLatch();

					// Transaction A leases a strict subset, then stays open (uncommitted) holding its
					// row locks until released.
					const primaryChunkPromise = primaryRepos.transaction(async (txRepos) => {
						const leasedRows = await txRepos.workflowRunOutbox.leaseDuePending(context, {
							leaseDurationMs: 5_000,
							limit: 2,
						});
						primaryChunkLeased.signal();
						await commitPrimaryTx.wait();
						return leasedRows;
					});
					await primaryChunkLeased.wait();

					// Connection B leases while A is still open. Without the outer eligibility guard,
					// B would take A's leased rows — both saw them due before A's lease was written.
					const secondaryChunkPromise = secondaryRepos.workflowRunOutbox.leaseDuePending(context, {
						leaseDurationMs: 5_000,
						limit: 100,
					});

					commitPrimaryTx.signal();
					const primaryLeasedRows = await primaryChunkPromise;
					const secondaryLeasedRows = await secondaryChunkPromise;

					const primaryOutboxRowIds = primaryLeasedRows.map((row) => row.id);
					const secondaryOutboxRowIds = secondaryLeasedRows.map((row) => row.id);
					const overlap = primaryOutboxRowIds.filter((outboxRowId) => secondaryOutboxRowIds.includes(outboxRowId));
					expect(overlap).toEqual([]);

					expect([...primaryOutboxRowIds, ...secondaryOutboxRowIds].sort()).toEqual(
						seededOutboxRows.map((row) => row.id).sort()
					);
				});
			})
		));
});
