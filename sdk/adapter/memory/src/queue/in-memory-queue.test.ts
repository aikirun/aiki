import { createBinaryLatch } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { noopLogger } from "@aikirun/lib/logger";
import { withFakeClient } from "@aikirun/testing/client";
import { readyWorkflowRunFactory } from "@aikirun/testing/data-factory/infra/queue";
import type { ApiClient } from "@aikirun/types/client";
import type { PublisherContext, SubscriberContext } from "@aikirun/types/infra/queue";
import type { WorkflowMeta, WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { type Broker, createBroker } from "./broker";
import { inMemoryQueue } from "./in-memory-queue";
import { createInMemoryPublisher } from "./publisher";
import { createInMemorySubscriber } from "./subscriber";
import { describe, expect, test } from "bun:test";

const logger = noopLogger;

const defaultWorkflow: WorkflowMeta = {
	source: "user",
	name: "sync-inventory" as WorkflowName,
	versionId: "v1" as WorkflowVersionId,
};

const otherWorkflow: WorkflowMeta = {
	source: "user",
	name: "reconcile-ledger" as WorkflowName,
	versionId: "v1" as WorkflowVersionId,
};

// The namespace every subscriber below resolves. readyWorkflowRunFactory stamps the same
// default on runs, so a run built without an explicit namespace lands in these subscribers' queues.
const identity = { organizationId: "org", namespaceId: "ns" };

const publisherContext = (): PublisherContext => ({
	logger,
	signal: new AbortController().signal,
});

const subscriberContext = (
	api: ApiClient,
	workflows?: NonEmptyArray<WorkflowMeta>,
	signal?: AbortSignal
): SubscriberContext => ({
	api,
	workerId: "worker-1",
	workflows: workflows ?? [defaultWorkflow],
	logger,
	signal: signal ?? new AbortController().signal,
});

describe("inMemoryQueue publish/subscribe", () => {
	test("delivers only the runs of the namespace a subscriber resolves", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1
				.once({}, { organizationId: "org", namespaceId: "acme" })
				.once({}, { organizationId: "org", namespaceId: "globex" });
			const queue = inMemoryQueue();
			await queue
				.publisher(publisherContext())
				.publishRuns([
					readyWorkflowRunFactory.build({ namespaceId: "globex", id: "globex-run" }),
					readyWorkflowRunFactory.build({ namespaceId: "acme", id: "acme-run" }),
				]);

			expect(await queue.subscriber(subscriberContext(client.api)).getReadyRuns(10)).toEqual([
				{ data: { id: "acme-run" as WorkflowRunId } },
			]);
			expect(await queue.subscriber(subscriberContext(client.api)).getReadyRuns(10)).toEqual([
				{ data: { id: "globex-run" as WorkflowRunId } },
			]);
		}));

	test("rejects when the namespace lookup fails", () =>
		withFakeClient(async (client) => {
			const lookupError = new Error("server unavailable");
			client.api.identity.getV1.rejectsOnce({}, lookupError);
			const queue = inMemoryQueue();

			const subscriber = queue.subscriber(subscriberContext(client.api));
			expect(subscriber.getReadyRuns(10)).rejects.toBe(lookupError);
		}));

	test("looks the namespace up again after a failed lookup", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.rejectsOnce({}, new Error("server unavailable")).once({}, identity);
			const queue = inMemoryQueue();
			await queue.publisher(publisherContext()).publishRuns([readyWorkflowRunFactory.build({ id: "run-1" })]);

			const subscriber = queue.subscriber(subscriberContext(client.api));
			expect(subscriber.getReadyRuns(10)).rejects.toThrow("server unavailable");
			expect(await subscriber.getReadyRuns(10)).toEqual([{ data: { id: "run-1" as WorkflowRunId } }]);
		}));

	test("delivers a published run to a subscriber", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());

			await publisher.publishRuns([readyWorkflowRunFactory.build({ id: "run-1" })]);

			const subscriber = queue.subscriber(subscriberContext(client.api));
			expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual(["run-1"]);
		}));

	test("returns runs in ascending rank order", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());

			await publisher.publishRuns([
				readyWorkflowRunFactory.build({ id: "third", rank: 3 }),
				readyWorkflowRunFactory.build({ id: "first", rank: 1 }),
				readyWorkflowRunFactory.build({ id: "second", rank: 2 }),
			]);

			const subscriber = queue.subscriber(subscriberContext(client.api));
			expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual([
				"first",
				"second",
				"third",
			]);
		}));

	test("breaks rank ties by id", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());

			await publisher.publishRuns([
				readyWorkflowRunFactory.build({ id: "run-b", rank: 1 }),
				readyWorkflowRunFactory.build({ id: "run-a", rank: 1 }),
				readyWorkflowRunFactory.build({ id: "run-c", rank: 1 }),
			]);

			const subscriber = queue.subscriber(subscriberContext(client.api));
			expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual([
				"run-a",
				"run-b",
				"run-c",
			]);
		}));

	test("round-robins across workflow queues", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());

			await publisher.publishRuns([
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

			const subscriber = queue.subscriber(subscriberContext(client.api, [defaultWorkflow, otherWorkflow]));
			// There are 2 workflow queues and the can start at either,
			// so either rotation of the interleave is valid.
			expect([
				["a1", "b1", "a2", "b2"],
				["b1", "a1", "b2", "a2"],
			]).toContainEqual((await subscriber.getReadyRuns(4)).map(({ data }) => data.id));
		}));

	test("returns at most `limit` runs and leaves the rest", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());
			const subscriber = queue.subscriber(subscriberContext(client.api));

			await publisher.publishRuns([
				readyWorkflowRunFactory.build({ id: "run-1", rank: 1 }),
				readyWorkflowRunFactory.build({ id: "run-2", rank: 2 }),
				readyWorkflowRunFactory.build({ id: "run-3", rank: 3 }),
			]);

			expect<string[]>((await subscriber.getReadyRuns(2)).map(({ data }) => data.id)).toEqual(["run-1", "run-2"]);
			expect<string[]>((await subscriber.getReadyRuns(10)).map(({ data }) => data.id)).toEqual(["run-3"]);
		}));

	test("reports every run in the published bucket", async () => {
		const queue = inMemoryQueue();
		const publisher = queue.publisher(publisherContext());

		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];
		const result = await publisher.publishRuns([readyRun1, readyRun2]);

		expect(result.published).toEqual({ runs: [{ run: readyRun1 }, { run: readyRun2 }] });
	});
});

describe("in-memory subscriber parking", () => {
	test("wakes a parked subscriber when a run is published", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const broker = createBroker();
			const parkReached = createBinaryLatch();
			// The subscriber calls getOrCreateQueue only when it parks on a queue.
			const subscriberBroker: Broker = {
				...broker,
				getOrCreateQueue: (queueName) => {
					parkReached.signal();
					return broker.getOrCreateQueue(queueName);
				},
			};
			const publisher = createInMemoryPublisher(broker)(publisherContext());
			const subscriber = createInMemorySubscriber(subscriberBroker)(subscriberContext(client.api));

			const pendingRuns = subscriber.getReadyRuns(10);
			await parkReached.wait();
			await publisher.publishRuns([readyWorkflowRunFactory.build({ id: "run-1" })]);

			expect<string[]>((await pendingRuns).map(({ data }) => data.id)).toEqual(["run-1"]);
		}));

	test("returns empty when the signal is already aborted", () =>
		withFakeClient(async (client) => {
			const queue = inMemoryQueue();
			const controller = new AbortController();
			controller.abort();

			const subscriber = queue.subscriber(subscriberContext(client.api, [defaultWorkflow], controller.signal));
			expect(await subscriber.getReadyRuns(10)).toEqual([]);
		}));

	test("returns empty when the signal aborts during the namespace lookup", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const lookupStarted = createBinaryLatch();
			const releaseLookup = createBinaryLatch();
			const api: ApiClient = {
				identity: {
					getV1: async (request, options) => {
						lookupStarted.signal();
						await releaseLookup.wait();
						return client.api.identity.getV1(request, options);
					},
				},
				workflowRun: client.api.workflowRun,
				task: client.api.task,
				schedule: client.api.schedule,
			};
			const queue = inMemoryQueue();
			const controller = new AbortController();
			const subscriber = queue.subscriber(subscriberContext(api, [defaultWorkflow], controller.signal));

			const pendingRuns = subscriber.getReadyRuns(10);
			await lookupStarted.wait();
			controller.abort();
			releaseLookup.signal();

			expect(await pendingRuns).toEqual([]);
		}));

	test("releases a parked subscriber when its signal aborts", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const broker = createBroker();
			const parkReached = createBinaryLatch();
			// The subscriber calls getOrCreateQueue only when it parks on a queue.
			const subscriberBroker: Broker = {
				...broker,
				getOrCreateQueue: (queueName) => {
					parkReached.signal();
					return broker.getOrCreateQueue(queueName);
				},
			};
			const controller = new AbortController();
			const subscriber = createInMemorySubscriber(subscriberBroker)(
				subscriberContext(client.api, [defaultWorkflow], controller.signal)
			);

			const pendingRuns = subscriber.getReadyRuns(10);
			await parkReached.wait();
			controller.abort();

			expect(await pendingRuns).toEqual([]);
		}));

	test("keeps a parked waiter through clear, which still receives work published after it", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const broker = createBroker();
			const parkReached = createBinaryLatch();
			// The subscriber calls getOrCreateQueue only when it parks on a queue.
			const subscriberBroker: Broker = {
				...broker,
				getOrCreateQueue: (queueName) => {
					parkReached.signal();
					return broker.getOrCreateQueue(queueName);
				},
			};
			const publisher = createInMemoryPublisher(broker)(publisherContext());
			const subscriber = createInMemorySubscriber(subscriberBroker)(subscriberContext(client.api));

			const pendingRuns = subscriber.getReadyRuns(10);
			await parkReached.wait();
			broker.clear();
			await publisher.publishRuns([readyWorkflowRunFactory.build({ id: "run-after-clear" })]);

			expect(await pendingRuns).toEqual([{ data: { id: "run-after-clear" as WorkflowRunId } }]);
		}));
});

describe("inMemoryQueue.clear", () => {
	test("drops queued items", () =>
		withFakeClient(async (client) => {
			client.api.identity.getV1.once({}, identity);
			const queue = inMemoryQueue();
			const publisher = queue.publisher(publisherContext());

			await publisher.publishRuns([readyWorkflowRunFactory.build({ id: "run-cleared" })]);
			queue.clear();
			await publisher.publishRuns([readyWorkflowRunFactory.build({ id: "run-kept" })]);

			const subscriber = queue.subscriber(subscriberContext(client.api));
			const runs = await subscriber.getReadyRuns(10);

			expect(runs).toEqual([{ data: { id: "run-kept" as WorkflowRunId } }]);
		}));
});
