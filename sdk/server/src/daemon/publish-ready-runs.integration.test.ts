import { publishReadyRuns } from "./publish-ready-runs";
import { describe, expect, test } from "bun:test";
import { pendingWorkflowRunOutboxRowFactory } from "../testing/data-factory/infra/workflow-run-outbox";
import { createDaemonHarness } from "../testing/harness";

const withHarness = createDaemonHarness();

describe("publishReadyRuns", () => {
	test("marks pending rows published once the broker accepts them", () =>
		withHarness(async ({ context, repos, publisher }) => {
			await repos.workflowRunOutbox.createBatch([
				pendingWorkflowRunOutboxRowFactory.build(),
				pendingWorkflowRunOutboxRowFactory.build(),
			]);

			await publishReadyRuns(
				context,
				{ repos, publisher },
				{ limit: 100, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
			);

			expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
		}));

	test("leaves rows pending when the broker rejects", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const pendingOutboxRow = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([pendingOutboxRow]);

			publisher.publishReadyRuns.rejectsOnce(expect.anything(), new Error("broker down"));

			expect(
				publishReadyRuns(
					context,
					{ repos, publisher },
					{ limit: 100, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
				)
			).rejects.toThrow("broker down");

			const stillPendingRows = await repos.workflowRunOutbox.listPending(context, 100);
			expect(stillPendingRows).toEqual([expect.objectContaining(pendingOutboxRow)]);
		}));
});
