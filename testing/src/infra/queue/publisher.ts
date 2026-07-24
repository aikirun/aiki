import type { Publisher, PublishRunsResult, ReadyWorkflowRun } from "@aikirun/types/infra/queue";
import { Factory } from "fishery";

import { expect } from "bun:test";

export const readyWorkflowRunFactory = Factory.define<ReadyWorkflowRun>(({ sequence }) => ({
	namespaceId: "ns",
	id: `run-${sequence}`,
	name: "sync-inventory",
	versionId: "v1",
	rank: 1,
}));

type PublishRunsRequest = Parameters<Publisher["publishReadyRuns"]>[0];
type PublishRunsResponse = PublishRunsResult | ((request: PublishRunsRequest) => PublishRunsResult);

/**
 * `Publisher.publishReadyRuns` augmented with one-off scripting. Unscripted calls take the success
 * path — every run reported as `published`. A queued `once`/`rejectsOnce` overrides the next call in
 * FIFO order, asserting its request first.
 */
export interface FakePublishReadyRuns {
	(request: PublishRunsRequest): Promise<PublishRunsResult>;

	/**
	 * Overrides the next call: asserts its request against `expectedRequest`, then resolves with
	 * `response` — a value, or a function that receives the actual request and returns the value.
	 * Pass `expect.anything()` to match any request.
	 */
	once(expectedRequest: PublishRunsRequest, response: PublishRunsResponse): FakePublishReadyRuns;

	/** Overrides the next call: asserts its request against `expectedRequest`, then throws `error`. */
	rejectsOnce(expectedRequest: PublishRunsRequest, error: unknown): FakePublishReadyRuns;
}

export interface FakePublisher extends Publisher {
	publishReadyRuns: FakePublishReadyRuns;
}

type ExpectedCallResult = { type: "resolve"; response: PublishRunsResponse } | { type: "reject"; error: unknown };

interface ExpectedCall {
	request: PublishRunsRequest;
	result: ExpectedCallResult;
}

/**
 * A `Publisher` that succeeds by default but can be scripted to fail or return a specific result.
 * Unscripted calls are not verified.
 */
export function fakePublisher(): FakePublisher {
	const expectedCalls: ExpectedCall[] = [];

	const publishReadyRuns = (async (actualRequest: PublishRunsRequest): Promise<PublishRunsResult> => {
		const expectedCall = expectedCalls.shift();
		if (expectedCall === undefined) {
			return { published: actualRequest.map((run) => ({ run })) };
		}
		expect(actualRequest).toEqual(expectedCall.request);

		const result = expectedCall.result;
		if (result.type === "reject") {
			throw result.error;
		}

		const { response } = result;
		return typeof response === "function" ? response(actualRequest) : response;
	}) as FakePublishReadyRuns;

	publishReadyRuns.once = (expectedRequest, response) => {
		expectedCalls.push({ request: expectedRequest, result: { type: "resolve", response } });
		return publishReadyRuns;
	};

	publishReadyRuns.rejectsOnce = (expectedRequest, error) => {
		expectedCalls.push({ request: expectedRequest, result: { type: "reject", error } });
		return publishReadyRuns;
	};

	return { publishReadyRuns };
}
