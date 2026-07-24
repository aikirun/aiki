import { publishReadyRuns } from "./publish-ready-runs";
import { describe, expect, test } from "bun:test";
import { createDaemonHarness } from "../testing/daemon-harness";
import { pendingWorkflowRunOutboxRowFactory } from "../testing/infra/db/types/workflow-run-outbox";

const withHarness = createDaemonHarness();

describe("publishReadyRuns", () => {
	test("marks pending rows published once the broker accepts them", () =>
		withHarness(async ({ context, repos, publisher }) => {
			await repos.workflowRunOutbox.createBatch([
				pendingWorkflowRunOutboxRowFactory.build(),
				pendingWorkflowRunOutboxRowFactory.build(),
			]);

			await publishReadyRuns(context, { repos, workflowRunPublisher: publisher }, { limit: 100 });

			expect(await repos.workflowRunOutbox.listPending(context, 100)).toHaveLength(0);
		}));

	test("leaves rows pending when the broker rejects", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const pendingOutboxRow = pendingWorkflowRunOutboxRowFactory.build();
			await repos.workflowRunOutbox.createBatch([pendingOutboxRow]);

			publisher.publishReadyRuns.rejectsOnce(expect.anything(), new Error("broker down"));

			expect(publishReadyRuns(context, { repos, workflowRunPublisher: publisher }, { limit: 100 })).rejects.toThrow(
				"broker down"
			);

			const stillPendingRows = await repos.workflowRunOutbox.listPending(context, 100);
			expect(stillPendingRows).toEqual([expect.objectContaining(pendingOutboxRow)]);
		}));
});
