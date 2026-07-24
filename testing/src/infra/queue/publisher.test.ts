import type { PublishRunsResult } from "@aikirun/types/infra/queue";

import { fakePublisher, readyWorkflowRunFactory } from "./publisher";
import { describe, expect, test } from "bun:test";

describe("fakePublisher", () => {
	test("reports every run as published by default", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		const result = await publisher.publishReadyRuns([readyRun1, readyRun2]);

		expect(result).toEqual({ published: [{ run: readyRun1 }, { run: readyRun2 }] });
	});

	test("rejectsOnce throws on the next call, then heals", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		publisher.publishReadyRuns.rejectsOnce(expect.anything(), new Error("broker down"));

		expect(publisher.publishReadyRuns([readyRun1])).rejects.toThrow("broker down");
		expect(await publisher.publishReadyRuns([readyRun2])).toEqual({
			published: [{ run: readyRun2 }],
		});
	});

	test("once returns a scripted PublishRunsResult value", async () => {
		const publisher = fakePublisher();
		const readyRun1 = readyWorkflowRunFactory.build();

		const degraded: PublishRunsResult = { failed: [{ run: readyRun1 }] };
		publisher.publishReadyRuns.once(expect.anything(), degraded);

		expect(await publisher.publishReadyRuns([readyRun1])).toEqual(degraded);
	});

	test("once accepts a function of the actual request", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		publisher.publishReadyRuns.once(expect.anything(), (runs) => ({ failed: runs.map((run) => ({ run })) }));

		const result = await publisher.publishReadyRuns([readyRun1, readyRun2]);

		expect(result).toEqual({ failed: [{ run: readyRun1 }, { run: readyRun2 }] });
	});

	test("asserts the request against the matcher", async () => {
		const publisher = fakePublisher();

		publisher.publishReadyRuns.once([readyWorkflowRunFactory.build({ id: "expected" })], { published: [] });

		expect(publisher.publishReadyRuns([readyWorkflowRunFactory.build({ id: "actual" })])).rejects.toThrow();
	});

	test("applies scripted calls in FIFO order, then defaults", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2, readyRun3] = [
			readyWorkflowRunFactory.build(),
			readyWorkflowRunFactory.build(),
			readyWorkflowRunFactory.build(),
		];

		publisher.publishReadyRuns
			.rejectsOnce(expect.anything(), new Error("first"))
			.once(expect.anything(), { published: [] });

		expect(publisher.publishReadyRuns([readyRun1])).rejects.toThrow("first");
		expect(await publisher.publishReadyRuns([readyRun2])).toEqual({ published: [] });
		expect(await publisher.publishReadyRuns([readyRun3])).toEqual({
			published: [{ run: readyRun3 }],
		});
	});
});
