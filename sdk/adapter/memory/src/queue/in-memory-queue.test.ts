import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { createConsoleLogger } from "@aikirun/lib/logger";
import { readyWorkflowRunFactory } from "@aikirun/testing/infra/queue";
import type { PublisherContext, SubscriberContext } from "@aikirun/types/infra/queue";
import type { WorkflowMeta, WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { inMemoryQueue } from "./in-memory-queue";
import { describe, expect, test } from "bun:test";

const logger = createConsoleLogger({ level: "ERROR" });

const defaultWorkflow: WorkflowMeta = {
	name: "sync-inventory" as WorkflowName,
	versionId: "v1" as WorkflowVersionId,
};

const otherWorkflow: WorkflowMeta = {
	name: "reconcile-ledger" as WorkflowName,
	versionId: "v1" as WorkflowVersionId,
};

const publisherContext = (): PublisherContext => ({
	logger,
	signal: new AbortController().signal,
});

const subscriberContext = (workflows?: NonEmptyArray<WorkflowMeta>, signal?: AbortSignal): SubscriberContext => ({
	workerId: "worker-1",
	workflows: workflows ?? [defaultWorkflow],
	logger,
	signal: signal ?? new AbortController().signal,
});

describe("inMemoryQueue publish/subscribe", () => {
	test("delivers a published run to a subscriber", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		await publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "run-1" })]);

		const subscriber = queue.subscriber(subscriberContext());
		expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual(["run-1"]);
	});

	test("returns runs in ascending rank order", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		await publisher.publishReadyRuns([
			readyWorkflowRunFactory.build({ id: "third", rank: 3 }),
			readyWorkflowRunFactory.build({ id: "first", rank: 1 }),
			readyWorkflowRunFactory.build({ id: "second", rank: 2 }),
		]);

		const subscriber = queue.subscriber(subscriberContext());
		expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	test("breaks rank ties by id", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		await publisher.publishReadyRuns([
			readyWorkflowRunFactory.build({ id: "run-b", rank: 1 }),
			readyWorkflowRunFactory.build({ id: "run-a", rank: 1 }),
			readyWorkflowRunFactory.build({ id: "run-c", rank: 1 }),
		]);

		const subscriber = queue.subscriber(subscriberContext());
		expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual([
			"run-a",
			"run-b",
			"run-c",
		]);
	});

	test("round-robins across workflow queues", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		await publisher.publishReadyRuns([
			readyWorkflowRunFactory.build({ id: "a1", rank: 1 }),
			readyWorkflowRunFactory.build({ id: "a2", rank: 2 }),
			readyWorkflowRunFactory.build({
				id: "b1",
				rank: 1,
				name: otherWorkflow.name,
				versionId: otherWorkflow.versionId,
			}),
			readyWorkflowRunFactory.build({
				id: "b2",
				rank: 2,
				name: otherWorkflow.name,
				versionId: otherWorkflow.versionId,
			}),
		]);

		const subscriber = queue.subscriber(subscriberContext([defaultWorkflow, otherWorkflow]));
		expect<string[]>((await subscriber.getReadyRuns(4)).map(({ data }) => data.id)).toEqual(["a1", "b1", "a2", "b2"]);
	});

	test("returns at most `limit` runs and leaves the rest", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());
		const subscriber = queue.subscriber(subscriberContext());

		await publisher.publishReadyRuns([
			readyWorkflowRunFactory.build({ id: "run-1", rank: 1 }),
			readyWorkflowRunFactory.build({ id: "run-2", rank: 2 }),
			readyWorkflowRunFactory.build({ id: "run-3", rank: 3 }),
		]);

		expect<string[]>((await subscriber.getReadyRuns(2)).map(({ data }) => data.id)).toEqual(["run-1", "run-2"]);
		expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual(["run-3"]);
	});

	test("reports every run in the published bucket", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];
		const result = await publisher.publishReadyRuns([readyRun1, readyRun2]);

		expect(result.published).toEqual([{ run: readyRun1 }, { run: readyRun2 }]);
	});
});

describe("inMemoryQueue waiters", () => {
	test("wakes a parked subscriber when a run is published", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());
		const subscriber = queue.subscriber(subscriberContext());

		const parked = subscriber.getReadyRuns(10);
		await publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "run-1" })]);

		expect<string[]>((await parked).map(({ data }) => data.id)).toEqual(["run-1"]);
	});

	test("returns empty when the signal is already aborted", async () => {
		const queue = inMemoryQueue();
		const controller = new AbortController();
		controller.abort();

		const subscriber = queue.subscriber(subscriberContext([defaultWorkflow], controller.signal));
		expect(await subscriber.getReadyRuns(10)).toEqual([]);
	});

	test("releases a parked subscriber when its signal aborts", async () => {
		const queue = inMemoryQueue();
		const controller = new AbortController();
		const subscriber = queue.subscriber(subscriberContext([defaultWorkflow], controller.signal));

		const parked = subscriber.getReadyRuns(10);
		controller.abort();

		expect(await parked).toEqual([]);
	});
});

describe("inMemoryQueue.clear", () => {
	test("keeps a parked waiter, which still receives work published after clear", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());
		const subscriber = queue.subscriber(subscriberContext());

		const parked = subscriber.getReadyRuns(10);
		queue.clear();
		await publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "run-after-clear" })]);

		expect(await parked).toEqual([{ data: { id: "run-after-clear" as WorkflowRunId } }]);
	});

	test("drops queued items", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		await publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "run-cleared" })]);
		queue.clear();
		await publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "run-kept" })]);

		const subscriber = queue.subscriber(subscriberContext());
		const runs = await subscriber.getReadyRuns(10);

		expect(runs).toEqual([{ data: { id: "run-kept" as WorkflowRunId } }]);
	});
});
