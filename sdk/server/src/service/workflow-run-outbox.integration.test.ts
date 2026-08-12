import type { TimestampMs } from "@aikirun/lib/timestamp";

import { describe, expect, test } from "bun:test";
import { recoverOverdueOutboxEntries } from "../daemon/recover-overdue-outbox-entries";
import type { WorkflowRunOutboxStatus } from "../infra/db/constants/workflow-run-outbox";
import { createWorkflowRunOutboxService } from "../service/workflow-run-outbox";
import { withFakeClock } from "../testing/clock";
import { daemonContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { claimRun, seedClaimedRun, seedPooledQueuedRun, seedPublishedRun, seedQueuedRun } from "../testing/run-seed";

const withHarness = createServiceHarness();

// -1 makes every claimed row stale by arithmetic (claimedAt < now + 1 always holds), so tests
// never depend on real time elapsing between the claim and the daemon run.
const EVERY_CLAIM_IS_STALE_MS = -1;

const EPOCH_MS = 1 as TimestampMs;

const daemonContext = daemonContextFactory.build();

describe("WorkflowRunOutboxService.claimReady", () => {
	test("returns a pending row for the requested workflow and transitions its outbox row to claimed", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, workflowSource, workflowName, workflowVersionId } = await seedQueuedRun({
				namespaceRequestContext: context,
				repos,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			});

			expect(result).toEqual([expect.objectContaining({ id: runId })]);

			const pendingRows = await repos.workflowRunOutbox.listPending(daemonContext, 100);
			expect(pendingRows).toHaveLength(0);

			const claimedRows = await repos.workflowRunOutbox.listStaleClaimed(daemonContext, {
				claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS,
				limit: 100,
			});
			expect(claimedRows).toEqual([expect.objectContaining({ workflowRunId: runId, status: "claimed" })]);
			expect(claimedRows[0]?.claimedAt).toBeGreaterThan(0);
		}));

	test("does not return a pending row for a workflow not in the request workflows list", () =>
		withHarness(async ({ context, repos }) => {
			await seedQueuedRun({ namespaceRequestContext: context, repos });

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: "user", name: "unknown-workflow", versionId: "v1" }],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));

	test("does not return a user row to a request naming the same workflow under the system source", () =>
		withHarness(async ({ context, repos }) => {
			const { workflowName, workflowVersionId } = await seedQueuedRun({
				namespaceRequestContext: context,
				repos,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: "system", name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));

	test("does not return a pending row outside the requested pools", () =>
		withHarness(async ({ context, repos }) => {
			// The seeded run has no pool; requesting a specific pool excludes it.
			const { workflowSource, workflowName, workflowVersionId } = await seedQueuedRun({
				namespaceRequestContext: context,
				repos,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				pools: ["eu-east"],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));

	test("claims a pending row in the requested pool", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, workflowSource, workflowName, workflowVersionId, pool } = await seedPooledQueuedRun({
				namespaceRequestContext: context,
				repos,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				pools: [pool],
				limit: 10,
			});

			expect(result).toEqual([expect.objectContaining({ id: runId })]);
		}));

	test("does not return a pooled row when the request has no pools", () =>
		withHarness(async ({ context, repos }) => {
			const { workflowSource, workflowName, workflowVersionId } = await seedPooledQueuedRun({
				namespaceRequestContext: context,
				repos,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));

	test("respects the limit and does not return more rows than requested", () =>
		withHarness(async ({ context, repos }) => {
			const seedQueuedRunDeps = { namespaceRequestContext: context, repos };
			const { workflowSource, workflowName, workflowVersionId } = await seedQueuedRun(seedQueuedRunDeps);
			await seedQueuedRun(seedQueuedRunDeps);
			await seedQueuedRun(seedQueuedRunDeps);

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 2,
			});

			expect(result).toHaveLength(2);
		}));

	test("does not return a claimed row", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, workflowSource, workflowName, workflowVersionId } = await seedQueuedRun({
				namespaceRequestContext: context,
				repos,
			});
			await claimRun({ context, repos, runId });

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));

	test("does not return a published row", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { workflowSource, workflowName, workflowVersionId } = await seedPublishedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const outboxService = createWorkflowRunOutboxService({ repos });
			const result = await outboxService.claimReady(context, {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			});

			expect(result).toHaveLength(0);
		}));
});

describe("claimReady visibility after recovery", () => {
	test("a stale claimed row and a publishable row are invisible to claimReady until recovery returns them to pending", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const seedRunDeps = { namespaceRequestContext: context, repos, publisher };
			const {
				runId: claimedRunId,
				workflowSource,
				workflowName,
				workflowVersionId,
			} = await seedClaimedRun(seedRunDeps);
			const { runId: publishedRunId } = await withFakeClock(EPOCH_MS, () => seedPublishedRun(seedRunDeps));

			const outboxService = createWorkflowRunOutboxService({ repos });
			const claimRequest = {
				workflows: [{ source: workflowSource, name: workflowName, versionId: workflowVersionId }],
				limit: 10,
			};

			// Both rows are in non-pending statuses; claimReady sees nothing.
			const beforeRecovery = await outboxService.claimReady(context, claimRequest);
			expect(beforeRecovery).toHaveLength(0);

			// Recovery returns the stale claimed row and the publishable row to pending.
			await recoverOverdueOutboxEntries(
				daemonContext,
				{ repos },
				{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
			);

			// Both runs are now visible to claimReady.
			const afterRecovery = await outboxService.claimReady(context, claimRequest);
			expect(afterRecovery).toHaveLength(2);
			expect(afterRecovery).toEqual([
				expect.objectContaining({ id: claimedRunId }),
				expect.objectContaining({ id: publishedRunId }),
			]);
		}));
});

describe("WorkflowRunOutboxService.refreshClaim", () => {
	test("stamps a fresh claimedAt on a claimed row", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedClaimedRun({ namespaceRequestContext: context, repos, publisher })
			);

			const outboxService = createWorkflowRunOutboxService({ repos });
			await outboxService.refreshClaim(context, runId);

			const row = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: context.namespaceId,
				workflowRunId: runId,
			});
			expect(row).toEqual(expect.objectContaining({ workflowRunId: runId, status: "claimed" }));
			expect(row?.claimedAt).toBeGreaterThan(EPOCH_MS);
		}));

	Object.entries({
		pending: seedQueuedRun,
		published: seedPublishedRun,
	} satisfies Record<Exclude<WorkflowRunOutboxStatus, "claimed">, unknown>).forEach(([status, seedRun]) => {
		test(`does not refresh a ${status} row`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ namespaceRequestContext: context, repos, publisher });

				const outboxService = createWorkflowRunOutboxService({ repos });
				await outboxService.refreshClaim(context, runId);

				const row = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: context.namespaceId,
					workflowRunId: runId,
				});
				expect(row).toEqual(expect.objectContaining({ workflowRunId: runId, status, claimedAt: null }));
			}));
	});
});
