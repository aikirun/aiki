import type { TimestampMs } from "@aikirun/lib/timestamp";
import { describe, expect, test } from "vitest";

import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import type { Repositories } from "../infra/db/types";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { claimRun, seedClaimedRun, seedPublishedRun, seedQueuedRun } from "../testing/seed/run";
import { seedRecoveredRun } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_MINUTE_MS = 60 * 1000;

describe("stallUndeliverableRuns", () => {
	test("stalls a queued run whose outbox row is older than the limit", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { runId, revisionWhenQueued } = await withFakeClock(EPOCH_MS, () =>
				seedQueuedRun({ daemonContext: context, namespaceRequestContext, repos })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "stalled", revision: revisionWhenQueued + 1 }),
					state: { status: "stalled" },
				})
			);
		}));

	test("charges no execution attempt", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { runId, revisionWhenQueued, attemptsWhenQueued } = await withFakeClock(EPOCH_MS, () =>
				seedQueuedRun({ daemonContext: context, namespaceRequestContext, repos })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "stalled", attempts: attemptsWhenQueued }),
				})
			);
			expect(await repos.stateTransition.listByRunId(runId, 1)).toEqual(
				expect.objectContaining({
					rows: [
						expect.objectContaining({
							workflowRunId: runId,
							type: "workflow_run",
							revision: revisionWhenQueued + 1,
							attempt: attemptsWhenQueued,
							state: { status: "stalled" },
						}),
					],
				})
			);
		}));

	test("deletes the stalled run's outbox row", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedQueuedRun({ daemonContext: context, namespaceRequestContext, repos })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("also stalls a run whose row was published but never claimed", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedPublishedRun({ daemonContext: context, namespaceRequestContext, repos, publisher })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "stalled" }) }));
		}));

	test("stalls a run whose row is exactly at the limit and keeps one a millisecond newer", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const scannedAt = 1_000_000;
			const cutoffAt = scannedAt - ONE_MINUTE_MS;
			const runAtLimit = await withFakeClock(cutoffAt, () =>
				seedQueuedRun({ daemonContext: context, namespaceRequestContext, repos })
			);
			const runInsideLimit = await withFakeClock(cutoffAt + 1, () =>
				seedQueuedRun({ daemonContext: context, namespaceRequestContext, repos })
			);

			await withFakeClock(scannedAt, () =>
				stallUndeliverableRuns(
					context,
					{ repos },
					{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
				)
			);

			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runAtLimit.runId,
				})
			).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runAtLimit.runId, status: "stalled" }) }));
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runInsideLimit.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runInsideLimit.runId,
						status: "queued",
						revision: runInsideLimit.revisionWhenQueued,
					}),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runInsideLimit.runId,
				})
			).toEqual(expect.objectContaining({ id: runInsideLimit.outboxRowId, status: "pending" }));
		}));

	test("never stalls a run a worker has claimed, however old its row", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenClaimed, outboxRowId } = await withFakeClock(EPOCH_MS, () =>
				seedClaimedRun({ daemonContext: context, namespaceRequestContext, repos, publisher })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "running", revision: revisionWhenClaimed }),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ id: outboxRowId, status: "claimed" }));
		}));

	test("leaves alone a run a worker claims after the listing, and keeps its row", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const runToClaimAfterListing = await withFakeClock(EPOCH_MS, () => seedPublishedRun(seedDeps));
			const undeliveredRun = await withFakeClock(EPOCH_MS, () => seedPublishedRun(seedDeps));

			let listedRunIds: string[] = [];
			const reposClaimingAfterListing: Repositories = {
				...repos,
				workflowRunOutbox: {
					...repos.workflowRunOutbox,
					listUndeliverable: async (...args) => {
						const undeliverableRows = await repos.workflowRunOutbox.listUndeliverable(...args);
						listedRunIds = undeliverableRows.map((row) => row.workflowRunId);
						await claimRun({ context: namespaceRequestContext, repos, runId: runToClaimAfterListing.runId });
						return undeliverableRows;
					},
				},
			};

			// The other run is stalled in the same pass, so the pass goes on to delete outbox rows.
			await stallUndeliverableRuns(
				context,
				{ repos: reposClaimingAfterListing },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);
			expect(listedRunIds.sort()).toEqual([runToClaimAfterListing.runId, undeliveredRun.runId].sort());

			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runToClaimAfterListing.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runToClaimAfterListing.runId, status: "running" }),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runToClaimAfterListing.runId,
				})
			).toEqual(expect.objectContaining({ id: runToClaimAfterListing.outboxRowId, status: "claimed" }));
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: undeliveredRun.runId,
				})
			).toEqual(
				expect.objectContaining({ run: expect.objectContaining({ id: undeliveredRun.runId, status: "stalled" }) })
			);
		}));

	test("discards the tasks a dead worker left running or awaiting a retry, and keeps the completed and failed ones", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, taskIdByStatus } = await withFakeClock(EPOCH_MS, () =>
				seedRecoveredRun({ daemonContext: context, namespaceRequestContext, repos, publisher })
			);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
			);

			const discardedTasks = await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["discarded"]);
			expect(discardedTasks.map((task) => task.id).sort()).toEqual(
				[taskIdByStatus.running, taskIdByStatus.awaiting_retry].sort()
			);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["completed"])).toEqual([
				expect.objectContaining({ id: taskIdByStatus.completed, status: "completed" }),
			]);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["failed"])).toEqual([
				expect.objectContaining({ id: taskIdByStatus.failed, status: "failed" }),
			]);
		}));

	test("drains every old row when they outnumber the page size", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos };
			const queuedRuns = await withFakeClock(EPOCH_MS, async () => [
				await seedQueuedRun(seedDeps),
				await seedQueuedRun(seedDeps),
				await seedQueuedRun(seedDeps),
			]);

			await stallUndeliverableRuns(
				context,
				{ repos },
				{ maxAgeMs: ONE_MINUTE_MS, pageSize: 2, chunk: { size: 100, maxConcurrency: 10 } }
			);

			for (const { runId } of queuedRuns) {
				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "stalled" }) }));
			}
		}));
});
