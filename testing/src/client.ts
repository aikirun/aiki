import { createConsoleLogger } from "@aikirun/lib/logger";
import type { ApiClient, Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunRecord } from "@aikirun/types/workflow/run";

import { expect, type Mock, mock } from "bun:test";

type MockEndpoint<Args extends unknown[], Return> = Mock<(...args: Args) => Return> & {
	/**
	 * Queues a single expected call: the Nth call to this endpoint is paired with the
	 * Nth `once` and resolves with `response`. Queue several to expect several calls.
	 *
	 * The match is EXACT by default — every field must be accounted for.
	 * For a partial match, pass an asymmetric matcher,
	 * e.g. `expect.objectContaining({ ... })` or `expect.anything()`.
	 *
	 * A call with no expectation throws immediately. Separately, `verify()` compares the
	 * expected calls against the calls actually made — position by position — and reports any that
	 * were missing, unexpected, or sent with the wrong request. So a mismatch is caught even for a
	 * fire-and-forget call whose inline throw is swallowed by the caller.
	 *
	 * `response` is either a value or a function that receives the actual request and returns the value.
	 * Use the function form when the response derives from the request, such as echoing parts of the
	 * request back in the result. The `response` argument is omitted entirely for endpoints that
	 * resolve to `void`.
	 */
	once(
		expectedRequest: Args[0],
		...response: Awaited<Return> extends void
			? []
			: [response: Awaited<Return> | ((actualRequest: Args[0]) => Awaited<Return>)]
	): MockEndpoint<Args, Return>;

	/**
	 * Queues a single expected call that rejects: matched like {@link once}, but throws `error`
	 * instead of resolving.
	 */
	rejectsOnce(expectedRequest: Args[0], error: unknown): MockEndpoint<Args, Return>;

	/**
	 * Registers `callback` that is invoked once the next time this endpoint is called — regardless of
	 * whether that call matches an expectation.
	 */
	onNextCall(callback: () => void): void;
};

/** Every API method becomes a `MockEndpoint` of its own signature. */
type MockApi<T> = {
	[K in keyof T]: T[K] extends (...args: infer Args) => infer Return ? MockEndpoint<Args, Return> : MockApi<T[K]>;
};

export interface FakeClient<Context = null> extends Client<Context> {
	api: MockApi<ApiClient>;
	/**
	 * Throws unless the calls made match the expected calls via `once`/`rejectsOnce`, in order —
	 * reporting any that were missing, unexpected, or sent with the wrong request.
	 */
	verify(): void;
}

type ExpectedCallResult = { type: "resolve"; response: unknown } | { type: "reject"; error: unknown };

interface ExpectedCall {
	request: unknown;
	result: ExpectedCallResult;
}

interface ActualCall {
	request: unknown;
}

interface RegisteredEndpoint {
	name: string;
	expectedCalls: ExpectedCall[];
	actualCalls: ActualCall[];
}

/**
 * A `Client` whose every API endpoint is an auto-created mock augmented with `once` and `rejectsOnce`.
 * Queue the calls a test expects; any call with no queued expectation throws.
 *
 * Use it through {@link withFakeClient}, which calls `verify()` for you on success:
 */
function fakeClient<Context = null>(options: FakeClientOptions<Context> = {}): FakeClient<Context> {
	const endpoints: RegisteredEndpoint[] = [];

	const createEndpoint = (endpointName: string): unknown => {
		const expectedCalls: ExpectedCall[] = [];
		const actualCalls: ActualCall[] = [];
		const callbacks: Array<() => void> = [];
		endpoints.push({ name: endpointName, expectedCalls, actualCalls });

		const handler = async (actualRequest: unknown) => {
			actualCalls.push({ request: actualRequest });
			for (const callback of callbacks.splice(0)) {
				callback();
			}

			const expectedCall = expectedCalls[actualCalls.length - 1];
			if (expectedCall === undefined) {
				throw new Error(`Fake client: unexpected call to ${endpointName}(${Bun.inspect(actualRequest)})`);
			}
			expect(actualRequest).toEqual(expectedCall.request);

			const result = expectedCall.result;
			if (result.type === "reject") {
				throw result.error;
			}
			if (typeof result.response === "function") {
				return result.response(actualRequest);
			}
			return result.response;
		};

		const endpoint = mock(handler) as Mock<typeof handler> & {
			once: (expectedRequest: unknown, response?: unknown) => unknown;
			rejectsOnce: (expectedRequest: unknown, error: unknown) => unknown;
			onNextCall: (callback: () => void) => void;
		};
		endpoint.once = (expectedRequest, response) => {
			expectedCalls.push({ request: expectedRequest, result: { type: "resolve", response } });
			return endpoint;
		};
		endpoint.rejectsOnce = (expectedRequest, error) => {
			expectedCalls.push({ request: expectedRequest, result: { type: "reject", error } });
			return endpoint;
		};
		endpoint.onNextCall = (callback) => {
			callbacks.push(callback);
		};

		return endpoint;
	};

	const createSubApi = (subApiName: string): unknown => {
		const subApiEndpoints = new Map<string, unknown>();

		return new Proxy(
			{},
			{
				get(_target, endpointName) {
					if (typeof endpointName === "symbol") {
						return undefined;
					}
					const existingEndpoint = subApiEndpoints.get(endpointName);
					if (existingEndpoint !== undefined) {
						return existingEndpoint;
					}
					const createdEndpoint = createEndpoint(`${subApiName}.${endpointName}`);
					subApiEndpoints.set(endpointName, createdEndpoint);
					return createdEndpoint;
				},
			}
		);
	};

	const subApis = new Map<string, unknown>();
	const api = new Proxy(
		{},
		{
			get(_target, subApiName) {
				if (typeof subApiName === "symbol") {
					return undefined;
				}
				const existingSubApi = subApis.get(subApiName);
				if (existingSubApi !== undefined) {
					return existingSubApi;
				}
				const createdSubApi = createSubApi(subApiName);
				subApis.set(subApiName, createdSubApi);
				return createdSubApi;
			},
		}
	) as MockApi<ApiClient>;

	const verify = () => {
		const problems: string[] = [];
		for (const { name, expectedCalls, actualCalls } of endpoints) {
			const count = Math.max(expectedCalls.length, actualCalls.length);
			for (let i = 0; i < count; i++) {
				const expectedCall = expectedCalls[i];
				const actualCall = actualCalls[i];

				if (expectedCall === undefined) {
					problems.push(`unexpected call to ${name}(${Bun.inspect(actualCall?.request)})`);
				} else if (actualCall === undefined) {
					problems.push(`expected call to ${name}(${Bun.inspect(expectedCall.request)}) was never made`);
				} else {
					try {
						expect(actualCall.request).toEqual(expectedCall.request);
					} catch {
						problems.push(
							`call to ${name} expected ${Bun.inspect(expectedCall.request)} but received ${Bun.inspect(actualCall.request)}`
						);
					}
				}
			}
		}
		if (problems.length > 0) {
			throw new Error(`Fake client: ${problems.join("; ")}`);
		}
	};

	return {
		api,
		logger: createConsoleLogger({ level: "DEBUG" }),
		[INTERNAL]: options.context ? { context: options.context } : {},
		verify,
	};
}

/** Configures a fake client. `context` supplies the per-run context factory the SDK reads from the client. */
export interface FakeClientOptions<Context> {
	context?: (run: WorkflowRunRecord) => Context | Promise<Context>;
}

type FakeClientFn<Context> = (client: Omit<FakeClient<Context>, "verify">) => Promise<void> | void;

/**
 * Runs `fn` with a fresh fake client, then asserts every queued call was made.
 *
 * `verify()` runs only after `fn` resolves, so a failure inside `fn` propagates with its own
 * error — never masked by a verification error.
 *
 * @example
 * test("activates a schedule", () =>
 *   withFakeClient(async (client) => {
 *     client.api.schedule.activateV1.once(expectedRequest, response);
 *     await schedule(params).activate(client, workflow, input);
 *   }));
 */
export async function withFakeClient<Context = null>(fn: FakeClientFn<Context>): Promise<void>;
export async function withFakeClient<Context>(
	options: FakeClientOptions<Context>,
	fn: FakeClientFn<Context>
): Promise<void>;
export async function withFakeClient<Context>(
	optionsOrFn: FakeClientOptions<Context> | FakeClientFn<Context>,
	maybeFn?: FakeClientFn<Context>
): Promise<void> {
	const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
	const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
	const client = fakeClient<Context>(options);
	if (fn) {
		await fn(client);
	}
	client.verify();
}
