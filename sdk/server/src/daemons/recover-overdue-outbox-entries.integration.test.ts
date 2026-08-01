import type { TimestampMs } from "@aikirun/lib/timestamp";

import { recoverOverdueOutboxEntries } from "./recover-overdue-outbox-entries";
import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import { describe, expect, test } from "bun:test";
import { createWorkflowRunOutboxService } from "../service/workflow-run-outbox";
import { withFakeClock } from "../testing/clock";
import { createDaemonHarness } from "../testing/harness";
import { namespaceRequestContextFactory } from "../testing/middleware/context";
import { claimRun, seedClaimedRun, seedPublishedRun, seedQueuedRun } from "../testing/run-seed";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

// -1 makes every claimed row stale by arithmetic (claimedAt < now + 1 always holds), so tests
// never depend on real time elapsing between the claim and the daemon run.
const EVERY_CLAIM_IS_STALE_MS = -1;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const EPOCH_MS = 1 as TimestampMs;

describe("recoverOverdueOutboxEntries", () => {
	describe("stale claimed rows", () => {
		test("returns the stale claimed outbox row to pending with its delivery holds cleared", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
					expect.objectContaining({
						id: outboxRowId,
						workflowRunId: runId,
						claimedAt: null,
						nextPublishAttemptAt: null,
					}),
				]);
			}));

		test("preserves firstPublishedAt so the republish backoff curve survives recovery", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				const claimedRows = await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100);
				expect(claimedRows).toHaveLength(1);
				const firstPublishedAt = claimedRows[0]?.firstPublishedAt;
				expect(firstPublishedAt).toBeGreaterThan(0);

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId, firstPublishedAt }),
				]);
			}));

		test("releases the abandoned run to queued with reason recovered", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(
					expect.objectContaining({
						id: runId,
						status: "queued",
						state: { status: "queued", reason: "recovered" },
					})
				);
			}));

		test("bumps the run revision so a lost worker's next write is fenced", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, revisionWhenClaimed } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(expect.objectContaining({ id: runId, status: "queued" }));
				expect(run?.revision).toBeGreaterThan(revisionWhenClaimed);
			}));

		test("charges no execution attempt for the lost claim", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, attemptsWhenClaimed } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(expect.objectContaining({ id: runId, attempts: attemptsWhenClaimed }));
			}));

		test("leaves a fresh claim untouched", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await seedClaimedRun({
					daemonContext: deps.context,
					namespaceRequestContext,
					publisher: deps.publisher,
					repos: deps.repos,
				});

				await recoverOverdueOutboxEntries(context, { repos }, { claimIdleTimeoutMs: ONE_HOUR_MS, limit: 100 });

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
				expect(await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId }),
				]);
			}));

		test("leaves a refreshed claim untouched", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await withFakeClock(EPOCH_MS, () =>
					seedClaimedRun({
						daemonContext: deps.context,
						namespaceRequestContext,
						publisher: deps.publisher,
						repos: deps.repos,
					})
				);

				// The epoch-old claim is initially recoverable.
				expect(await repos.workflowRunOutbox.listStaleClaimed(context, ONE_HOUR_MS, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId }),
				]);

				const outboxService = createWorkflowRunOutboxService({ repos });
				await outboxService.refreshClaim(namespaceRequestContext, runId);

				await recoverOverdueOutboxEntries(context, { repos }, { claimIdleTimeoutMs: ONE_HOUR_MS, limit: 100 });

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
				expect(await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId }),
				]);
			}));
	});

	describe("publishable rows", () => {
		test("returns a publishable row to pending with firstPublishedAt preserved", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await withFakeClock(EPOCH_MS, () =>
					seedPublishedRun({
						daemonContext: deps.context,
						namespaceRequestContext,
						publisher: deps.publisher,
						repos: deps.repos,
					})
				);

				const publishableRows = await repos.workflowRunOutbox.listPublishable(context, 100);
				expect(publishableRows).toHaveLength(1);
				const firstPublishedAt = publishableRows[0]?.firstPublishedAt;
				expect(firstPublishedAt).toBeGreaterThan(0);

				await recoverOverdueOutboxEntries(
					context,
					{ repos },
					{ claimIdleTimeoutMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
					expect.objectContaining({
						id: outboxRowId,
						workflowRunId: runId,
						nextPublishAttemptAt: null,
						firstPublishedAt,
					}),
				]);
			}));
	});

	describe("stallUndeliverableRuns sweep", () => {
		test("stalls an aged pending row", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId } = await withFakeClock(EPOCH_MS, () =>
					seedQueuedRun({ daemonContext: deps.context, namespaceRequestContext, repos: deps.repos })
				);

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(
					expect.objectContaining({
						id: runId,
						status: "stalled",
					})
				);
				expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
			}));

		test("stalls an aged published row", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId } = await withFakeClock(EPOCH_MS, () =>
					seedPublishedRun({
						daemonContext: deps.context,
						namespaceRequestContext,
						publisher: deps.publisher,
						repos: deps.repos,
					})
				);

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(
					expect.objectContaining({
						id: runId,
						status: "stalled",
					})
				);
				expect(await repos.workflowRunOutbox.listPublishable(context, 100)).toHaveLength(0);
			}));

		test("does not stall a claimed row regardless of age", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await withFakeClock(EPOCH_MS, () =>
					seedPublishedRun({
						daemonContext: deps.context,
						namespaceRequestContext,
						publisher: deps.publisher,
						repos: deps.repos,
					})
				);
				await claimRun({ context: namespaceRequestContext, repos, runId });

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceRequestContext.namespaceId, runId);
				expect(run).toEqual(
					expect.objectContaining({
						id: runId,
						status: "running",
					})
				);
				const claimedRows = await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100);
				expect(claimedRows).toEqual([expect.objectContaining({ id: outboxRowId, workflowRunId: runId })]);
			}));
	});
});
