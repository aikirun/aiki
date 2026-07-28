import type { TimestampMs } from "@aikirun/lib/timestamp";

import { processImminentScheduledRuns } from "./imminent-scheduled-runs";
import { publishReadyRuns } from "./publish-ready-runs";
import { recoverStaleOutboxEntries } from "./recover-stale-outbox-entries";
import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunService } from "../service/workflow-run";
import { createWorkflowRunStateMachineService } from "../service/workflow-run-state-machine";
import { withFakeClock } from "../testing/clock";
import { createDaemonHarness, type DaemonHarnessDeps } from "../testing/daemon-harness";
import { namespaceRequestContextFactory } from "../testing/middleware/context";

const withHarness = createDaemonHarness();

// -1 makes every claimed row stale by arithmetic (claimedAt < now + 1 always holds), so tests
// never depend on real time elapsing between the claim and the daemon run.
const EVERY_CLAIM_IS_STALE_MS = -1;
// Has the opposite effeft of EVERY_CLAIM_IS_STALE_MS; skip recovery for claims younger than 1 hour
const NO_CLAIM_GOES_STALE_MS = 1 * 60 * 60 * 1000;

const EPOCH_MS = 1 as TimestampMs;

const namespaceContext = namespaceRequestContextFactory.build();

describe("recoverStaleOutboxEntries", () => {
	describe("stale claimed rows", () => {
		test("returns the stale claimed outbox row to pending with its delivery holds cleared", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await seedClaimedRun(deps);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
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
				const { runId, outboxRowId } = await seedClaimedRun(deps);

				const claimedRows = await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100);
				expect(claimedRows).toHaveLength(1);
				const firstPublishedAt = claimedRows[0]?.firstPublishedAt;
				expect(firstPublishedAt).toBeGreaterThan(0);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId, firstPublishedAt }),
				]);
			}));

		test("releases the abandoned run to queued with reason recovered", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId } = await seedClaimedRun(deps);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
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
				const { runId, revisionWhenClaimed } = await seedClaimedRun(deps);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
				expect(run).toEqual(expect.objectContaining({ id: runId, status: "queued" }));
				expect(run?.revision).toBeGreaterThan(revisionWhenClaimed);
			}));

		test("charges no execution attempt for the lost claim", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, attemptsWhenClaimed } = await seedClaimedRun(deps);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
				);

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
				expect(run).toEqual(expect.objectContaining({ id: runId, attempts: attemptsWhenClaimed }));
			}));

		test("leaves a fresh claim untouched", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await seedClaimedRun(deps);

				await recoverStaleOutboxEntries(context, { repos }, { claimMinIdleTimeMs: NO_CLAIM_GOES_STALE_MS, limit: 100 });

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
				expect(await repos.workflowRunOutbox.listStaleClaimed(context, EVERY_CLAIM_IS_STALE_MS, 100)).toEqual([
					expect.objectContaining({ id: outboxRowId, workflowRunId: runId }),
				]);
			}));
	});

	describe("stale published rows", () => {
		test("returns a stale published row to pending with firstPublishedAt preserved", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await withFakeClock(EPOCH_MS, () => seedPublishedRun(deps));

				const publishedRows = await repos.workflowRunOutbox.listStalePublished(context, 100);
				expect(publishedRows).toHaveLength(1);
				const firstPublishedAt = publishedRows[0]?.firstPublishedAt;
				expect(firstPublishedAt).toBeGreaterThan(0);

				await recoverStaleOutboxEntries(
					context,
					{ repos },
					{ claimMinIdleTimeMs: EVERY_CLAIM_IS_STALE_MS, limit: 100 }
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
				const { runId } = await withFakeClock(EPOCH_MS, () => seedQueuedRun(deps));

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
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
				const { runId } = await withFakeClock(EPOCH_MS, () => seedPublishedRun(deps));

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
				expect(run).toEqual(
					expect.objectContaining({
						id: runId,
						status: "stalled",
					})
				);
				expect(await repos.workflowRunOutbox.listStalePublished(context, 100)).toHaveLength(0);
			}));

		test("does not stall a claimed row regardless of age", () =>
			withHarness(async (deps) => {
				const { context, repos } = deps;
				const { runId, outboxRowId } = await withFakeClock(EPOCH_MS, () => seedPublishedRun(deps));
				await claimRun(repos, runId);

				await stallUndeliverableRuns(context, { repos }, { maxAgeMs: 60_000, limit: 100 });

				const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
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

function createServices(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachineService({ repos, childRunCanceller });
	const workflowRun = createWorkflowRunService({
		repos,
		childRunCanceller,
		workflowRunStateMachineService: workflowRunStateMachine,
	});
	return { workflowRun, workflowRunStateMachine };
}

async function seedQueuedRun({ context, repos }: DaemonHarnessDeps) {
	const services = createServices(repos);

	const runId = await services.workflowRun.createWorkflowRun(namespaceContext, {
		name: "ship-orders",
		versionId: "v2",
		input: { orderId: "order-7" },
	});

	await processImminentScheduledRuns(
		context,
		{ repos },
		{ limit: 100, imminenceThresholdMs: 0, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
	);

	const outboxRows = await repos.workflowRunOutbox.listPending(context, 100);
	expect(outboxRows).toHaveLength(1);
	// biome-ignore lint/style/noNonNullAssertion: the length has already been asserted
	const outboxRow = outboxRows[0]!;

	return { runId, outboxRowId: outboxRow.id };
}

async function claimRun(repos: Repositories, runId: string) {
	const services = createServices(repos);

	const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	const claim = await services.workflowRunStateMachine.transitionState(namespaceContext, {
		type: "optimistic",
		id: runId,
		state: { status: "running" },
		expectedRevision: run.revision,
	});

	return { revisionWhenClaimed: claim.revision, attemptsWhenClaimed: claim.attempts };
}

async function seedClaimedRun(deps: DaemonHarnessDeps) {
	const { context, repos, publisher } = deps;
	const { runId, outboxRowId } = await seedQueuedRun(deps);

	await publishReadyRuns(
		context,
		{ repos, workflowRunPublisher: publisher },
		{ limit: 100, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
	);

	const claim = await claimRun(repos, runId);
	return { runId, outboxRowId, ...claim };
}

async function seedPublishedRun(deps: DaemonHarnessDeps) {
	const { context, repos, publisher } = deps;
	const seeded = await seedQueuedRun(deps);

	await publishReadyRuns(
		context,
		{ repos, workflowRunPublisher: publisher },
		{ limit: 100, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
	);

	return seeded;
}
