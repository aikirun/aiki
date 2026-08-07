import { objectOverrider } from "@aikirun/lib/object";

import { publishPendingOutboxEntries } from "./publish-pending-outbox-entries";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { withFakeClock } from "../testing/clock";
import { pendingWorkflowRunOutboxRowFactory } from "../testing/data-factory/infra/workflow-run-outbox";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedQueuedRun } from "../testing/run-seed";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const configBuilder = objectOverrider(defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries)();

describe("publishPendingOutboxEntries", () => {
	test("marks pending rows published once the broker accepts them", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				await repos.workflowRunOutbox.createBatch([
					pendingWorkflowRunOutboxRowFactory.build(),
					pendingWorkflowRunOutboxRowFactory.build(),
				]);

				await publishPendingOutboxEntries(context, { repos, publisher }, configBuilder.build());

				expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
			});
		}));

	test("leaves rows pending when the broker rejects", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const pendingOutboxRow = pendingWorkflowRunOutboxRowFactory.build();
				await repos.workflowRunOutbox.createBatch([pendingOutboxRow]);

				publisher.publishRuns.rejectsOnce(expect.anything(), new Error("broker down"));

				expect(publishPendingOutboxEntries(context, { repos, publisher }, configBuilder.build())).rejects.toThrow(
					"broker down"
				);

				const stillPendingRows = await repos.workflowRunOutbox.listPending(context, 100);
				expect(stillPendingRows).toEqual([expect.objectContaining({ id: pendingOutboxRow.id })]);
			});
		}));

	test("drains chunk by chunk until a chunk comes back short of the limit", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const rowOne = pendingWorkflowRunOutboxRowFactory.build({ rank: 1, nextPublishAttemptRank: 1 });
				const rowTwo = pendingWorkflowRunOutboxRowFactory.build({ rank: 2, nextPublishAttemptRank: 2 });
				const rowThree = pendingWorkflowRunOutboxRowFactory.build({ rank: 3, nextPublishAttemptRank: 3 });
				await repos.workflowRunOutbox.createBatch([rowOne, rowTwo, rowThree]);

				publisher.publishRuns
					.once([expect.anything(), expect.anything()], (request) => ({
						published: { runs: request.map((run) => ({ run })) },
					}))
					.once([expect.anything()], (request) => ({
						published: { runs: request.map((run) => ({ run })) },
					}));

				await publishPendingOutboxEntries(context, { repos, publisher }, configBuilder.with("limit", 2).build());

				const pendingRows = await repos.workflowRunOutbox.listPending(context, 100);
				expect(pendingRows).toEqual([]);

				for (const row of [rowOne, rowTwo, rowThree]) {
					const publishedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
						namespaceId: row.namespaceId,
						workflowRunId: row.workflowRunId,
					});
					expect(publishedRow).toEqual(expect.objectContaining({ id: row.id, status: "published" }));
				}
			});
		}));
});

describe("publishOutboxEntries — outcome writes", () => {
	test("published bucket: transitions status and schedules the republish backoff", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId, outboxRowId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				await publishPendingOutboxEntries(
					context,
					{ repos, publisher },
					// base = max collapses the clamp, so the expected rank is exact.
					configBuilder.with("republishBackoff.baseDelayMs", 30_000).with("republishBackoff.maxDelayMs", 30_000).build()
				);

				const pendingRows = await repos.workflowRunOutbox.listPending(context, 100);
				expect(pendingRows).toEqual([]);

				const publishedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				// computeRank(now + 30_000, 9) = (1_000_000 + 30_000) * 10 + 9.
				expect(publishedRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "published", nextPublishAttemptRank: 10_300_009 })
				);
			});
		}));

	test("deferred bucket: schedules the transport-returned nextPublishAttemptAt", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, outboxRowId } = await seedQueuedRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
			});

			const deferredUntil = 7_777_777;
			publisher.publishRuns.once(expect.anything(), (request) => ({
				deferred: { runs: request.map((run) => ({ run, nextPublishAttemptAt: deferredUntil })) },
			}));

			await publishPendingOutboxEntries(context, { repos, publisher }, configBuilder.build());

			const deferredRow = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			// computeRank(7_777_777, 9) = 7_777_777 * 10 + 9.
			expect(deferredRow).toEqual(
				expect.objectContaining({ id: outboxRowId, status: "pending", nextPublishAttemptRank: 77_777_779 })
			);
		}));

	test("failed bucket: anchors the age backoff on createdAt when the row has never published", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 100_000;
			await withFakeClock(now, async () => {
				const row = pendingWorkflowRunOutboxRowFactory.build({
					rank: 19,
					nextPublishAttemptRank: 19,
					createdAt: 1_000,
				});
				await repos.workflowRunOutbox.createBatch([row]);

				publisher.publishRuns.once(expect.anything(), (request) => ({
					failed: { runs: request.map((run) => ({ run })) },
				}));

				await publishPendingOutboxEntries(
					context,
					{ repos, publisher },
					// setting baseDelayMs to -Inf and maxDelayMs to +Inf ensures the backoff is
					// never clamped, and is the duration since creation
					configBuilder
						.with("republishBackoff.baseDelayMs", Number.NEGATIVE_INFINITY)
						.with("republishBackoff.maxDelayMs", Number.POSITIVE_INFINITY)
						.build()
				);

				const failedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				});
				// age = 100_000 - 1_000
				// computeRank(now + age, 9) = 199_000 * 10 + 9.
				expect(failedRow).toEqual(
					expect.objectContaining({ id: row.id, status: "pending", nextPublishAttemptRank: 1_990_009 })
				);
			});
		}));

	test("failed bucket: anchors the age backoff on firstPublishedAt when the row has published before", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 100_000;
			await withFakeClock(now, async () => {
				// createdAt and firstPublishedAt diverge: a createdAt-anchored backoff would produce 1_990_009.
				const row = pendingWorkflowRunOutboxRowFactory.build({
					rank: 19,
					nextPublishAttemptRank: 19,
					createdAt: 1_000,
					firstPublishedAt: 60_000,
				});
				await repos.workflowRunOutbox.createBatch([row]);

				publisher.publishRuns.once(expect.anything(), (request) => ({
					failed: { runs: request.map((run) => ({ run })) },
				}));

				await publishPendingOutboxEntries(
					context,
					{ repos, publisher },
					// setting baseDelayMs to -Inf and maxDelayMs to +Inf ensures the backoff is
					// never clamped, and is the exact duration since first publish
					configBuilder
						.with("republishBackoff.baseDelayMs", Number.NEGATIVE_INFINITY)
						.with("republishBackoff.maxDelayMs", Number.POSITIVE_INFINITY)
						.build()
				);

				const failedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: row.namespaceId,
					workflowRunId: row.workflowRunId,
				});
				// age = 100_000 - 60_000; computeRank(now + age, 9) = 140_000 * 10 + 9.
				expect(failedRow).toEqual(
					expect.objectContaining({ id: row.id, status: "pending", nextPublishAttemptRank: 1_400_009 })
				);
			});
		}));

	test("declined bucket: schedules the fixed re-check interval", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId, outboxRowId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				publisher.publishRuns.once(expect.anything(), (request) => ({
					declined: { runs: request.map((run) => ({ run })) },
				}));

				await publishPendingOutboxEntries(
					context,
					{ repos, publisher },
					configBuilder.with("republishBackoff.declinedBackoffMs", 15_000).build()
				);

				const declinedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				// computeRank(now + 15_000, 9) = (1_000_000 + 15_000) * 10 + 9.
				expect(declinedRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "pending", nextPublishAttemptRank: 10_150_009 })
				);
			});
		}));

	test("publishRuns throwing leaves the lease value", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId, outboxRowId } = await seedQueuedRun({
					daemonContext: context,
					namespaceRequestContext,
					repos,
				});

				publisher.publishRuns.rejectsOnce(expect.anything(), new Error("broker down"));

				expect(
					publishPendingOutboxEntries(
						context,
						{ repos, publisher },
						configBuilder.with("leaseDurationMs", 5_000).build()
					)
				).rejects.toThrow("broker down");

				const leasedRow = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				// computeRank(now + leaseDurationMs, 9) = (1_000_000 + 5_000) * 10 + 9.
				expect(leasedRow).toEqual(
					expect.objectContaining({ id: outboxRowId, status: "pending", nextPublishAttemptRank: 10_050_009 })
				);
			});
		}));
});
