import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Publisher, PublishRunsResult, ReadyWorkflowRun } from "@aikirun/types/infra/queue";

import { expect } from "bun:test";

type PublishRunsRequest = NonEmptyArray<ReadyWorkflowRun>;
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
	/** Throws unless every queued `once`/`rejectsOnce` was consumed by a call. */
	verify(): void;
}

type ExpectedCallResult = { type: "resolve"; response: unknown } | { type: "reject"; error: unknown };

interface ExpectedCall {
	request: unknown;
	result: ExpectedCallResult;
}

/**
 * A `Publisher` that succeeds by default but can be scripted to fail or return a specific result.
 * `verify()` asserts every scripted call was made; unscripted calls are not verified.
 */
export function fakePublisher(): FakePublisher {
	const expectations = (() => {
		const expectedCallsByName = new Map<string, ExpectedCall[]>();
		return {
			getCalls(name: string) {
				const previousExpectedCalls = expectedCallsByName.get(name);
				if (previousExpectedCalls) {
					return previousExpectedCalls;
				}
				const expectedCalls: ExpectedCall[] = [];
				expectedCallsByName.set(name, expectedCalls);
				return expectedCalls;
			},
			verify() {
				const problems: string[] = [];
				for (const [name, expectedCalls] of expectedCallsByName) {
					for (const expectedCall of expectedCalls) {
						problems.push(`expected call to ${name}(${Bun.inspect(expectedCall.request)}) was never made`);
					}
				}
				if (problems.length > 0) {
					throw new Error(`fakePublisher: ${problems.join("; ")}`);
				}
			},
		};
	})();

	const publishReadyRunsFn = async (actualRequest: PublishRunsRequest): Promise<PublishRunsResult> => {
		const expectedCalls = expectations.getCalls(publishReadyRunsFn.name);
		const expectedCall = expectedCalls.shift();
		if (expectedCall === undefined) {
			return { published: actualRequest.map((run) => ({ run })) };
		}
		expect(actualRequest).toEqual(expectedCall.request as PublishRunsRequest);

		const result = expectedCall.result;
		if (result.type === "reject") {
			throw result.error;
		}

		const { response } = result;
		return typeof response === "function" ? response(actualRequest) : (response as PublishRunsResult);
	};

	const publishReadyRuns = Object.assign(publishReadyRunsFn, {
		once: (expectedRequest: PublishRunsRequest, response: PublishRunsResponse) => {
			const expectedCalls = expectations.getCalls(publishReadyRunsFn.name);
			expectedCalls.push({ request: expectedRequest, result: { type: "resolve", response } });
			return publishReadyRuns;
		},

		rejectsOnce: (expectedRequest: PublishRunsRequest, error: unknown) => {
			const expectedCalls = expectations.getCalls(publishReadyRunsFn.name);
			expectedCalls.push({ request: expectedRequest, result: { type: "reject", error } });
			return publishReadyRuns;
		},
	});

	return {
		publishReadyRuns,
		verify: () => expectations.verify(),
	};
}
