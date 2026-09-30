import { createBinaryLatch } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { describe, expect, test } from "bun:test";
import { withFakeClock } from "../../../testing/clock";
import { pendingWorkflowRunOutboxRowFactory } from "../../../testing/data-factory/infra/workflow-run-outbox";
import { namespaceRequestContextFactory } from "../../../testing/data-factory/middleware/context";
import { createDaemonHarness, withRepos } from "../../../testing/harness";
import { seedQueuedRun } from "../../../testing/seed/run";
import { WORKFLOW_RUN_OUTBOX_STATUSES, type WorkflowRunOutboxStatus } from "../constants/workflow-run-outbox";
import type { Repositories } from "../types";
import type {
	WorkflowRunOutboxRow,
	WorkflowRunOutboxRowInsert,
	WorkflowRunOutboxRowInsertPending,
} from "../types/workflow-run-outbox";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const enteredStatusAt = 1_000_000 as TimestampMs;
const backedOffRank = 20_000_000;

type OutboxRowColumns = Pick<
	WorkflowRunOutboxRow,
	"status" | "claimedAt" | "firstPublishedAt" | "lastPublishedAt" | "nextPublishAttemptRank"
>;
type SeedOutboxRow = (
	repos: Repositories
) => Promise<{ row: WorkflowRunOutboxRowInsertPending; columns: OutboxRowColumns }>;

// One outbox row per status, with the columns that status carries. Every row's next publish
// attempt rank is backed off beyond the due cutoff, so a write that reset it to `rank` shows.
const seedOutboxRowByStatus = {
	pending: async (repos) => {
		const row = pendingWorkflowRunOutboxRowFactory.build({ nextPublishAttemptRank: backedOffRank });
		await repos.workflowRunOutbox.createBatch([row]);
		return {
			row,
			columns: {
				status: "pending",
				claimedAt: null,
				firstPublishedAt: null,
				lastPublishedAt: null,
				nextPublishAttemptRank: backedOffRank,
			},
		};
	},
	claimed: async (repos) => {
		const row = pendingWorkflowRunOutboxRowFactory.build({ nextPublishAttemptRank: backedOffRank });
		await repos.workflowRunOutbox.createBatch([row]);
		await withFakeClock(enteredStatusAt, () =>
			repos.workflowRunOutbox.markClaimed(row.namespaceId, row.workflowRunId as WorkflowRunId)
		);
		return {
			row,
			columns: {
				status: "claimed",
				claimedAt: enteredStatusAt,
				firstPublishedAt: null,
				lastPublishedAt: null,
				nextPublishAttemptRank: backedOffRank,
			},
		};
	},
	published: async (repos) => {
		const row = pendingWorkflowRunOutboxRowFactory.build();
		await repos.workflowRunOutbox.createBatch([row]);
		await withFakeClock(enteredStatusAt, () =>
			repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: backedOffRank }])
		);
		return {
			row,
			columns: {
				status: "published",
				claimedAt: null,
				firstPublishedAt: enteredStatusAt,
				lastPublishedAt: enteredStatusAt,
				nextPublishAttemptRank: backedOffRank,
			},
		};
	},
} satisfies Record<WorkflowRunOutboxStatus, SeedOutboxRow>;

describe("leaseDuePending", () => {
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
				// rank 17 carries priority digit 7.
				const row = pendingWorkflowRunOutboxRowFactory.build({ rank: 17, nextPublishAttemptRank: 17 });
				await repos.workflowRunOutbox.createBatch([row]);

				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 3_000, limit: 100 });
				expect(leased).toEqual([expect.objectContaining({ id: row.id })]);

				const leasedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				});
				// computeRank(now + leaseDurationMs, 7) = (1_000_000 + 3_000) * 10 + 7.
				expect(leasedRow).toEqual(expect.objectContaining({ nextPublishAttemptRank: 10_030_007 }));
			});
		}));

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

describe("claimPending", () => {
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

	test("with pools, claims only rows in one of those pools", () =>
		withHarness(async ({ repos }) => {
			const workflowName = "sync-inventory";
			const workflowVersionId = "v1";
			const rowFactory = pendingWorkflowRunOutboxRowFactory.associations({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowSource: "user",
				workflowName,
				workflowVersionId,
			});
			const euRow = rowFactory.build({ pool: "warehouse-eu" });
			const usRow = rowFactory.build({ pool: "warehouse-us" });
			const unpooledRow = rowFactory.build({ pool: null });
			await repos.workflowRunOutbox.createBatch([euRow, usRow, unpooledRow]);

			const claimedRows = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{
					workflows: [{ source: "user", name: workflowName, versionId: workflowVersionId }],
					pools: ["warehouse-eu", "warehouse-apac"],
				},
				100
			);

			expect(claimedRows).toEqual([{ workflowRunId: euRow.workflowRunId }]);
		}));

	test("without pools, claims only rows that have no pool", () =>
		withHarness(async ({ repos }) => {
			const workflowName = "sync-inventory";
			const workflowVersionId = "v1";
			const rowFactory = pendingWorkflowRunOutboxRowFactory.associations({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowSource: "user",
				workflowName,
				workflowVersionId,
			});
			const euRow = rowFactory.build({ pool: "warehouse-eu" });
			const usRow = rowFactory.build({ pool: "warehouse-us" });
			const unpooledRow = rowFactory.build({ pool: null });
			await repos.workflowRunOutbox.createBatch([euRow, usRow, unpooledRow]);

			const claimedRows = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{ workflows: [{ source: "user", name: workflowName, versionId: workflowVersionId }] },
				100
			);

			expect(claimedRows).toEqual([{ workflowRunId: unpooledRow.workflowRunId }]);
		}));

	test("claims only rows in the caller's namespace", () =>
		withHarness(async ({ repos }) => {
			const workflowName = "sync-inventory";
			const workflowVersionId = "v1";
			const rowFactory = pendingWorkflowRunOutboxRowFactory.associations({
				workflowSource: "user",
				workflowName,
				workflowVersionId,
			});
			const ownRow = rowFactory.build({ namespaceId: namespaceRequestContext.namespaceId });
			const otherNamespaceRow = rowFactory.build({ namespaceId: namespaceRequestContextFactory.build().namespaceId });
			await repos.workflowRunOutbox.createBatch([otherNamespaceRow, ownRow]);

			const claimedRows = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{ workflows: [{ source: "user", name: workflowName, versionId: workflowVersionId }] },
				100
			);

			expect(claimedRows).toEqual([{ workflowRunId: ownRow.workflowRunId }]);
		}));

	test("claims the lowest ranks first when more are pending than the limit", () =>
		withHarness(async ({ repos }) => {
			const workflowName = "sync-inventory";
			const workflowVersionId = "v1";
			const rowFactory = pendingWorkflowRunOutboxRowFactory.associations({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowSource: "user",
				workflowName,
				workflowVersionId,
			});
			// rank and nextPublishAttemptRank deliberately diverge: ordering by nextPublishAttemptRank would pick claimedLast first.
			const claimedFirst = rowFactory.build({ rank: 1, nextPublishAttemptRank: 30 });
			const claimedSecond = rowFactory.build({ rank: 20, nextPublishAttemptRank: 20 });
			const claimedLast = rowFactory.build({ rank: 30, nextPublishAttemptRank: 10 });
			await repos.workflowRunOutbox.createBatch([claimedLast, claimedFirst, claimedSecond]);

			const claimedRows = await repos.workflowRunOutbox.claimPending(
				namespaceRequestContext.namespaceId,
				{ workflows: [{ source: "user", name: workflowName, versionId: workflowVersionId }] },
				2
			);

			expect(claimedRows.map((row) => row.workflowRunId).sort()).toEqual(
				[claimedFirst.workflowRunId, claimedSecond.workflowRunId].sort()
			);
		}));

	test("a backed-off pending row is invisible to the delivery lease but visible to claimPending", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId, outboxRowId, workflowSource, workflowName, workflowVersionId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				// Back the row off beyond the due cutoff computeRank(now, lowest priority) = 10_000_009,
				// as a deferred/failed outcome would.
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

describe("setNextPublishAttemptRank", () => {
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
					expect.objectContaining({ id: outboxRowId, status: "claimed", nextPublishAttemptRank: 10_000_005 })
				);
			});
		}));
});

describe("markPublished", () => {
	test("marks a pending row published with the given next attempt rank and stamps both publish times at the current instant", () =>
		withHarness(async ({ repos }) => {
			const publishedAt = 1_000_000;
			const row = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([row]);

			await withFakeClock(publishedAt, () =>
				repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: 20_000_000 }])
			);

			const publishedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: row.namespaceId,
				workflowRunId: row.workflowRunId,
			});
			expect(publishedRow).toEqual(
				expect.objectContaining({
					id: row.id,
					status: "published",
					firstPublishedAt: publishedAt,
					lastPublishedAt: publishedAt,
					nextPublishAttemptRank: 20_000_000,
					claimedAt: null,
				})
			);
		}));

	test("a second publish after the row returns to pending keeps the first publish time and moves the last", () =>
		withHarness(async ({ repos }) => {
			const firstPublishedAt = 1_000_000;
			const secondPublishedAt = 2_000_000;
			const row = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([row]);

			await withFakeClock(firstPublishedAt, () =>
				repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: 20_000_000 }])
			);
			await repos.workflowRunOutbox.returnToPending([row.id], "published");
			await withFakeClock(secondPublishedAt, () =>
				repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: 30_000_000 }])
			);

			const republishedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: row.namespaceId,
				workflowRunId: row.workflowRunId,
			});
			expect(republishedRow).toEqual(
				expect.objectContaining({
					id: row.id,
					status: "published",
					firstPublishedAt,
					lastPublishedAt: secondPublishedAt,
					nextPublishAttemptRank: 30_000_000,
				})
			);
		}));

	describe("pending-only guard", () => {
		const seedRowByOtherStatus = {
			claimed: seedOutboxRowByStatus.claimed,
			published: seedOutboxRowByStatus.published,
		} satisfies Record<Exclude<WorkflowRunOutboxStatus, "pending">, SeedOutboxRow>;

		for (const [status, seedOutboxRow] of Object.entries(seedRowByOtherStatus)) {
			test(`leaves a ${status} row as it is`, () =>
				withHarness(async ({ repos }) => {
					const republishedAt = 2_000_000;
					const { row, columns } = await seedOutboxRow(repos);

					await withFakeClock(republishedAt, () =>
						repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: 30_000_000 }])
					);

					const untouchedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
						namespaceId: row.namespaceId,
						workflowRunId: row.workflowRunId,
					});
					expect(untouchedRow).toEqual(expect.objectContaining({ id: row.id, ...columns }));
				}));
		}
	});
});

describe("returnToPending", () => {
	test("returns a published row to pending and makes it due at once, keeping the publish times its backoff is anchored on", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const row = pendingWorkflowRunOutboxRowFactory.build({ rank: 42, nextPublishAttemptRank: 42 });
				await repos.workflowRunOutbox.createBatch([row]);
				await repos.workflowRunOutbox.markPublished([{ id: row.id, nextPublishAttemptRank: 20_000_000 }]);

				await repos.workflowRunOutbox.returnToPending([row.id], "published");

				const restoredRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				});
				expect(restoredRow).toEqual(
					expect.objectContaining({
						id: row.id,
						status: "pending",
						nextPublishAttemptRank: 42,
						firstPublishedAt: now,
						lastPublishedAt: now,
						claimedAt: null,
					})
				);

				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 5_000, limit: 100 });
				expect(leased).toEqual([expect.objectContaining({ id: row.id })]);
			});
		}));

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
					expect.objectContaining({ id: outboxRowId, status: "pending", nextPublishAttemptRank: 10_000_005 })
				);

				// The restored rank sits within the due cutoff, so the delivery lease takes it.
				const leased = await repos.workflowRunOutbox.leaseDuePending(context, { leaseDurationMs: 5_000, limit: 100 });
				expect(leased).toEqual([expect.objectContaining({ id: outboxRowId })]);
			});
		}));

	describe("from-status guard", () => {
		const seedRowByOtherStatusFrom = {
			claimed: { pending: seedOutboxRowByStatus.pending, published: seedOutboxRowByStatus.published },
			published: { pending: seedOutboxRowByStatus.pending, claimed: seedOutboxRowByStatus.claimed },
		} satisfies {
			[From in Exclude<WorkflowRunOutboxStatus, "pending">]: Record<
				Exclude<WorkflowRunOutboxStatus, From>,
				SeedOutboxRow
			>;
		};

		for (const fromStatus of WORKFLOW_RUN_OUTBOX_STATUSES) {
			if (fromStatus === "pending") {
				continue;
			}
			for (const [status, seedOutboxRow] of Object.entries(seedRowByOtherStatusFrom[fromStatus])) {
				test(`from ${fromStatus} leaves a ${status} row as it is`, () =>
					withHarness(async ({ repos }) => {
						const { row, columns } = await seedOutboxRow(repos);

						await repos.workflowRunOutbox.returnToPending([row.id], fromStatus);

						const untouchedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
							namespaceId: row.namespaceId,
							workflowRunId: row.workflowRunId,
						});
						expect(untouchedRow).toEqual(expect.objectContaining({ id: row.id, ...columns }));
					}));
			}
		}
	});
});

describe("markClaimed", () => {
	test("marks the run's row in the namespace claimed at the current instant", () =>
		withHarness(async ({ context, repos }) => {
			const claimedAt = 1_000_000;
			const { runId, outboxRowId } = await seedQueuedRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
			});

			await withFakeClock(claimedAt, () =>
				repos.workflowRunOutbox.markClaimed(namespaceRequestContext.namespaceId, runId)
			);

			const claimedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			expect(claimedRow).toEqual(expect.objectContaining({ id: outboxRowId, status: "claimed", claimedAt }));
		}));

	test("leaves the row alone when the namespace does not match", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, outboxRowId } = await seedQueuedRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
			});

			await repos.workflowRunOutbox.markClaimed(namespaceRequestContextFactory.build().namespaceId, runId);

			const pendingRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			expect(pendingRow).toEqual(expect.objectContaining({ id: outboxRowId, status: "pending", claimedAt: null }));
		}));
});

describe("refreshClaim", () => {
	test("moves a claimed row's claim time to the current instant", () =>
		withHarness(async ({ context, repos }) => {
			const claimedAt = 1_000_000;
			const refreshedAt = 2_000_000;
			const { runId, outboxRowId } = await seedQueuedRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
			});
			await withFakeClock(claimedAt, () =>
				repos.workflowRunOutbox.markClaimed(namespaceRequestContext.namespaceId, runId)
			);

			await withFakeClock(refreshedAt, () =>
				repos.workflowRunOutbox.refreshClaim(namespaceRequestContext.namespaceId, runId)
			);

			const refreshedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			expect(refreshedRow).toEqual(
				expect.objectContaining({ id: outboxRowId, status: "claimed", claimedAt: refreshedAt })
			);
		}));

	test("leaves the claim time alone when the namespace does not match", () =>
		withHarness(async ({ context, repos }) => {
			const claimedAt = 1_000_000;
			const refreshAttemptedAt = 2_000_000;
			const { runId, outboxRowId } = await seedQueuedRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
			});
			await withFakeClock(claimedAt, () =>
				repos.workflowRunOutbox.markClaimed(namespaceRequestContext.namespaceId, runId)
			);

			await withFakeClock(refreshAttemptedAt, () =>
				repos.workflowRunOutbox.refreshClaim(namespaceRequestContextFactory.build().namespaceId, runId)
			);

			const claimedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			expect(claimedRow).toEqual(expect.objectContaining({ id: outboxRowId, status: "claimed", claimedAt }));
		}));

	describe("claimed-only guard", () => {
		const seedRowByOtherStatus = {
			pending: seedOutboxRowByStatus.pending,
			published: seedOutboxRowByStatus.published,
		} satisfies Record<Exclude<WorkflowRunOutboxStatus, "claimed">, SeedOutboxRow>;

		for (const [status, seedOutboxRow] of Object.entries(seedRowByOtherStatus)) {
			test(`leaves a ${status} row as it is`, () =>
				withHarness(async ({ repos }) => {
					const refreshAttemptedAt = 2_000_000;
					const { row, columns } = await seedOutboxRow(repos);

					await withFakeClock(refreshAttemptedAt, () =>
						repos.workflowRunOutbox.refreshClaim(row.namespaceId, row.workflowRunId as WorkflowRunId)
					);

					const untouchedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
						namespaceId: row.namespaceId,
						workflowRunId: row.workflowRunId,
					});
					expect(untouchedRow).toEqual(expect.objectContaining({ id: row.id, ...columns }));
				}));
		}
	});
});

describe("listDueForRepublish", () => {
	test("lists a published row at the due cutoff and skips one scheduled beyond it", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const atCutoffRow = pendingWorkflowRunOutboxRowFactory.build();
				const beyondCutoffRow = pendingWorkflowRunOutboxRowFactory.build();
				await repos.workflowRunOutbox.createBatch([atCutoffRow, beyondCutoffRow]);
				await repos.workflowRunOutbox.markPublished([
					{ id: atCutoffRow.id, nextPublishAttemptRank: 10_000_009 },
					{ id: beyondCutoffRow.id, nextPublishAttemptRank: 10_000_010 },
				]);

				const dueRows = await repos.workflowRunOutbox.listDueForRepublish(context, { limit: 100 });

				expect(dueRows).toEqual([expect.objectContaining({ id: atCutoffRow.id })]);
			});
		}));

	test("lists only published rows", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const pendingRow = pendingWorkflowRunOutboxRowFactory.build();
				const publishedRow = pendingWorkflowRunOutboxRowFactory.build();
				const claimedRow = pendingWorkflowRunOutboxRowFactory.build();
				await repos.workflowRunOutbox.createBatch([pendingRow, publishedRow, claimedRow]);
				await repos.workflowRunOutbox.markPublished([{ id: publishedRow.id, nextPublishAttemptRank: 1 }]);
				await repos.workflowRunOutbox.markClaimed(claimedRow.namespaceId, claimedRow.workflowRunId as WorkflowRunId);

				const dueRows = await repos.workflowRunOutbox.listDueForRepublish(context, { limit: 100 });

				expect(dueRows).toEqual([expect.objectContaining({ id: publishedRow.id, status: "published" })]);
			});
		}));

	test("orders by next attempt rank then id and resumes past a cursor", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const rows: NonEmptyArray<WorkflowRunOutboxRowInsert> = [
					pendingWorkflowRunOutboxRowFactory.build({ id: "R3" }),
					pendingWorkflowRunOutboxRowFactory.build({ id: "R1" }),
					pendingWorkflowRunOutboxRowFactory.build({ id: "R2" }),
				];
				await repos.workflowRunOutbox.createBatch(rows);
				await repos.workflowRunOutbox.markPublished([
					{ id: "R1", nextPublishAttemptRank: 2 },
					{ id: "R2", nextPublishAttemptRank: 1 },
					{ id: "R3", nextPublishAttemptRank: 2 },
				]);

				const firstPage = await repos.workflowRunOutbox.listDueForRepublish(context, { limit: 2 });
				expect(firstPage).toEqual([
					expect.objectContaining({ id: "R2", nextPublishAttemptRank: 1 }),
					expect.objectContaining({ id: "R1", nextPublishAttemptRank: 2 }),
				]);

				const secondPage = await repos.workflowRunOutbox.listDueForRepublish(context, {
					limit: 2,
					cursor: { order: 2, id: "R1", maxSeenId: "R2" },
				});
				expect(secondPage).toEqual([expect.objectContaining({ id: "R3", nextPublishAttemptRank: 2 })]);
			});
		}));
});

describe("listStaleClaimed", () => {
	test("lists a claim idle longer than the timeout and skips one idle exactly the timeout", () =>
		withHarness(async ({ context, repos }) => {
			const staleClaimedAt = 1_000_000;
			const atCutoffClaimedAt = 1_001_000;
			const now = 1_006_000;
			const claimIdleTimeoutMs = 5_000;
			const staleRow = pendingWorkflowRunOutboxRowFactory.build();
			const atCutoffRow = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([staleRow, atCutoffRow]);
			await withFakeClock(staleClaimedAt, () =>
				repos.workflowRunOutbox.markClaimed(staleRow.namespaceId, staleRow.workflowRunId as WorkflowRunId)
			);
			// now - claimIdleTimeoutMs = 1_001_000: this claim sits exactly on the cutoff.
			await withFakeClock(atCutoffClaimedAt, () =>
				repos.workflowRunOutbox.markClaimed(atCutoffRow.namespaceId, atCutoffRow.workflowRunId as WorkflowRunId)
			);

			const staleRows = await withFakeClock(now, () =>
				repos.workflowRunOutbox.listStaleClaimed(context, { claimIdleTimeoutMs, limit: 100 })
			);

			expect(staleRows).toEqual([expect.objectContaining({ id: staleRow.id, claimedAt: staleClaimedAt })]);
		}));

	test("orders by claim time then id and resumes past a cursor", () =>
		withHarness(async ({ context, repos }) => {
			const earlierClaimedAt = 1_000;
			const laterClaimedAt = 2_000;
			const now = 1_000_000;
			const earliestClaimedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "C2" });
			const firstTiedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "C1" });
			const secondTiedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "C3" });
			await repos.workflowRunOutbox.createBatch([secondTiedRow, firstTiedRow, earliestClaimedRow]);
			const claimRowAt = (row: WorkflowRunOutboxRowInsertPending, claimedAt: number) =>
				withFakeClock(claimedAt, () =>
					repos.workflowRunOutbox.markClaimed(row.namespaceId, row.workflowRunId as WorkflowRunId)
				);
			await claimRowAt(earliestClaimedRow, earlierClaimedAt);
			await claimRowAt(firstTiedRow, laterClaimedAt);
			await claimRowAt(secondTiedRow, laterClaimedAt);

			const firstPage = await withFakeClock(now, () =>
				repos.workflowRunOutbox.listStaleClaimed(context, { claimIdleTimeoutMs: 5_000, limit: 2 })
			);
			expect(firstPage).toEqual([
				expect.objectContaining({ id: "C2", claimedAt: earlierClaimedAt }),
				expect.objectContaining({ id: "C1", claimedAt: laterClaimedAt }),
			]);

			const secondPage = await withFakeClock(now, () =>
				repos.workflowRunOutbox.listStaleClaimed(context, {
					claimIdleTimeoutMs: 5_000,
					limit: 2,
					cursor: { order: laterClaimedAt, id: "C1", maxSeenId: "C2" },
				})
			);
			expect(secondPage).toEqual([expect.objectContaining({ id: "C3", claimedAt: laterClaimedAt })]);
		}));
});

describe("listUndeliverable", () => {
	test("lists pending and published rows up to and including maxId in id order", () =>
		withHarness(async ({ context, repos }) => {
			const pendingRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A1" });
			const claimedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A2" });
			const publishedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A3" });
			const beyondMaxIdRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A4" });
			await repos.workflowRunOutbox.createBatch([publishedRow, pendingRow, beyondMaxIdRow, claimedRow]);
			await repos.workflowRunOutbox.markClaimed(claimedRow.namespaceId, claimedRow.workflowRunId as WorkflowRunId);
			await repos.workflowRunOutbox.markPublished([{ id: publishedRow.id, nextPublishAttemptRank: 1 }]);

			const undeliverableRows = await repos.workflowRunOutbox.listUndeliverable(context, { maxId: "A3", limit: 100 });

			expect(undeliverableRows).toEqual([
				{ id: "A1", workflowRunId: pendingRow.workflowRunId },
				{ id: "A3", workflowRunId: publishedRow.workflowRunId },
			]);
		}));

	test("resumes strictly after the cursor id", () =>
		withHarness(async ({ context, repos }) => {
			const pendingRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A1" });
			const claimedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A2" });
			const publishedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A3" });
			const beyondMaxIdRow = pendingWorkflowRunOutboxRowFactory.build({ id: "A4" });
			await repos.workflowRunOutbox.createBatch([publishedRow, pendingRow, beyondMaxIdRow, claimedRow]);
			await repos.workflowRunOutbox.markClaimed(claimedRow.namespaceId, claimedRow.workflowRunId as WorkflowRunId);
			await repos.workflowRunOutbox.markPublished([{ id: publishedRow.id, nextPublishAttemptRank: 1 }]);

			const undeliverableRows = await repos.workflowRunOutbox.listUndeliverable(context, {
				maxId: "A3",
				limit: 100,
				cursorId: "A1",
			});

			expect(undeliverableRows).toEqual([{ id: "A3", workflowRunId: publishedRow.workflowRunId }]);
		}));
});

describe("listPending", () => {
	test("lists pending rows by next attempt rank then id up to the limit, leaving out other statuses", () =>
		withHarness(async ({ context, repos }) => {
			// rank and nextPublishAttemptRank deliberately diverge: ordering by rank would pick dueLast first.
			const dueFirst = pendingWorkflowRunOutboxRowFactory.build({ id: "P3", rank: 30, nextPublishAttemptRank: 10 });
			const dueSecond = pendingWorkflowRunOutboxRowFactory.build({ id: "P1", rank: 20, nextPublishAttemptRank: 20 });
			const dueThird = pendingWorkflowRunOutboxRowFactory.build({ id: "P2", rank: 20, nextPublishAttemptRank: 20 });
			const dueLast = pendingWorkflowRunOutboxRowFactory.build({ id: "P4", rank: 1, nextPublishAttemptRank: 30 });
			const publishedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "P5", rank: 5, nextPublishAttemptRank: 5 });
			const claimedRow = pendingWorkflowRunOutboxRowFactory.build({ id: "P6", rank: 5, nextPublishAttemptRank: 5 });
			await repos.workflowRunOutbox.createBatch([dueLast, publishedRow, dueThird, claimedRow, dueSecond, dueFirst]);
			await repos.workflowRunOutbox.markPublished([{ id: publishedRow.id, nextPublishAttemptRank: 5 }]);
			await repos.workflowRunOutbox.markClaimed(claimedRow.namespaceId, claimedRow.workflowRunId as WorkflowRunId);

			const pendingRows = await repos.workflowRunOutbox.listPending(context, 3);

			expect(pendingRows).toEqual([
				expect.objectContaining({ id: dueFirst.id, status: "pending" }),
				expect.objectContaining({ id: dueSecond.id, status: "pending" }),
				expect.objectContaining({ id: dueThird.id, status: "pending" }),
			]);
		}));
});

describe("deleteByWorkflowRunIds", () => {
	test("deletes the rows of the given runs and leaves the others", () =>
		withHarness(async ({ repos }) => {
			const firstDeletedRow = pendingWorkflowRunOutboxRowFactory.build();
			const secondDeletedRow = pendingWorkflowRunOutboxRowFactory.build();
			const keptRow = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([firstDeletedRow, keptRow, secondDeletedRow]);

			await repos.workflowRunOutbox.deleteByWorkflowRunIds([
				firstDeletedRow.workflowRunId,
				secondDeletedRow.workflowRunId,
			]);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: firstDeletedRow.namespaceId,
					workflowRunId: firstDeletedRow.workflowRunId,
				})
			).toBeNull();
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: secondDeletedRow.namespaceId,
					workflowRunId: secondDeletedRow.workflowRunId,
				})
			).toBeNull();
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: keptRow.namespaceId,
					workflowRunId: keptRow.workflowRunId,
				})
			).toEqual(expect.objectContaining({ id: keptRow.id }));
		}));
});

describe("deleteByWorkflowRunId", () => {
	test("deletes the run's row only within its namespace", () =>
		withHarness(async ({ repos }) => {
			const row = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([row]);

			await repos.workflowRunOutbox.deleteByWorkflowRunId({
				namespaceId: namespaceRequestContextFactory.build().namespaceId,
				workflowRunId: row.workflowRunId,
			});
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				})
			).toEqual(expect.objectContaining({ id: row.id }));

			await repos.workflowRunOutbox.deleteByWorkflowRunId({
				namespaceId: row.namespaceId,
				workflowRunId: row.workflowRunId,
			});
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				})
			).toBeNull();
		}));
});
