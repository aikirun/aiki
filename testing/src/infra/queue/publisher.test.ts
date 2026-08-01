import type { PublishRunsResult } from "@aikirun/types/infra/queue";

import { fakePublisher } from "./publisher";
import { describe, expect, test } from "bun:test";
import { readyWorkflowRunFactory } from "../../data-factory/infra/queue";

describe("fakePublisher", () => {
	test("reports every run as published by default", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		const result = await publisher.publishRuns([readyRun1, readyRun2]);

		expect(result).toEqual({ published: [{ run: readyRun1 }, { run: readyRun2 }] });
	});

	test("rejectsOnce throws on the next call, then heals", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		publisher.publishRuns.rejectsOnce(expect.anything(), new Error("broker down"));

		expect(publisher.publishRuns([readyRun1])).rejects.toThrow("broker down");
		expect(await publisher.publishRuns([readyRun2])).toEqual({
			published: [{ run: readyRun2 }],
		});
	});

	test("once returns a scripted PublishRunsResult value", async () => {
		const publisher = fakePublisher();
		const readyRun1 = readyWorkflowRunFactory.build();

		const degraded: PublishRunsResult = { failed: [{ run: readyRun1 }] };
		publisher.publishRuns.once(expect.anything(), degraded);

		expect(await publisher.publishRuns([readyRun1])).toEqual(degraded);
	});

	test("once accepts a function of the actual request", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2] = [readyWorkflowRunFactory.build(), readyWorkflowRunFactory.build()];

		publisher.publishRuns.once(expect.anything(), (runs) => ({ failed: runs.map((run) => ({ run })) }));

		const result = await publisher.publishRuns([readyRun1, readyRun2]);

		expect(result).toEqual({ failed: [{ run: readyRun1 }, { run: readyRun2 }] });
	});

	test("asserts the request against the matcher", async () => {
		const publisher = fakePublisher();

		publisher.publishRuns.once([readyWorkflowRunFactory.build({ id: "expected" })], { published: [] });

		expect(publisher.publishRuns([readyWorkflowRunFactory.build({ id: "actual" })])).rejects.toThrow();
	});

	test("applies scripted calls in FIFO order, then defaults", async () => {
		const publisher = fakePublisher();
		const [readyRun1, readyRun2, readyRun3] = [
			readyWorkflowRunFactory.build(),
			readyWorkflowRunFactory.build(),
			readyWorkflowRunFactory.build(),
		];

		publisher.publishRuns.rejectsOnce(expect.anything(), new Error("first")).once(expect.anything(), { published: [] });

		expect(publisher.publishRuns([readyRun1])).rejects.toThrow("first");
		expect(await publisher.publishRuns([readyRun2])).toEqual({ published: [] });
		expect(await publisher.publishRuns([readyRun3])).toEqual({
			published: [{ run: readyRun3 }],
		});
	});

	test("verify passes once every scripted call has been made", async () => {
		const publisher = fakePublisher();
		publisher.publishRuns.once(expect.anything(), { published: [] });

		await publisher.publishRuns([readyWorkflowRunFactory.build()]);

		expect(() => publisher.verify()).not.toThrow();
	});

	test("verify throws when a scripted call was never made", () => {
		const publisher = fakePublisher();
		publisher.publishRuns.once(expect.anything(), { published: [] });

		expect(() => publisher.verify()).toThrow();
	});
});
