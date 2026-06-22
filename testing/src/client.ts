import { createConsoleLogger } from "@aikirun/lib/logger";
import type { ApiClient, Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";

import { expect, type Mock, mock } from "bun:test";

type MockEndpoint<Args extends unknown[], Return> = Mock<(...args: Args) => Return> & {
	/**
	 * Queues a single expected call: the next call to this endpoint asserts its request
	 * `toEqual`s `request` and resolves with `response`. Each `once` covers exactly one call;
	 * queue several to expect several calls, matched in order.
	 *
	 * The match is EXACT by default — every field must be accounted for. For a partial match,
	 * pass an asymmetric matcher, e.g. `expect.objectContaining({ ... })` or `expect.anything()`.
	 *
	 * A queued `once` that is never called fails `verify()`.
	 * A call with no queued expectation throws.
	 *
	 * The `response` argument is omitted for endpoints that resolve to `void`.
	 */
	once(
		request: Args[0],
		...response: Awaited<Return> extends void ? [] : [response: Awaited<Return>]
	): MockEndpoint<Args, Return>;
};

/** Every API method becomes a `MockEndpoint` of its own signature. */
type MockApi<T> = {
	[K in keyof T]: T[K] extends (...args: infer Args) => infer Return ? MockEndpoint<Args, Return> : MockApi<T[K]>;
};

export interface FakeClient<Context = null> extends Client<Context> {
	api: MockApi<ApiClient>;
	/**
	 * Throws if any call queued via `once` was never made.
	 */
	verify(): void;
}

interface QueuedCall {
	request: unknown;
	response: unknown;
}

interface RegisteredEndpoint {
	name: string;
	queuedCalls: QueuedCall[];
}

/**
 * A `Client` whose every API endpoint is an auto-created mock augmented with `once`.
 * Queue the calls a test expects; any call with no queued expectation throws.
 *
 * Use it through {@link withFakeClient}, which calls `verify()` for you on success:
 */
function fakeClient<Context = null>(): FakeClient<Context> {
	const endpoints: RegisteredEndpoint[] = [];

	const createEndpoint = (endpointName: string): unknown => {
		const queuedCalls: QueuedCall[] = [];
		endpoints.push({ name: endpointName, queuedCalls });

		const handler = async (actual: unknown) => {
			const call = queuedCalls.shift();
			if (call === undefined) {
				throw new Error(`Fake client: unexpected call to ${endpointName}(${Bun.inspect(actual)})`);
			}
			expect(actual).toEqual(call.request);
			return call.response;
		};
		const endpoint = mock(handler) as Mock<typeof handler> & {
			once: (request: unknown, response?: unknown) => unknown;
		};

		endpoint.once = (request, response) => {
			queuedCalls.push({ request, response });
			return endpoint;
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
		const unconsumed = endpoints
			.filter((endpoint) => endpoint.queuedCalls.length > 0)
			.flatMap((endpoint) => endpoint.queuedCalls.map((call) => `${endpoint.name}(${Bun.inspect(call.request)})`));
		if (unconsumed.length > 0) {
			throw new Error(`Fake client: expected calls were never made: ${unconsumed.join(", ")}`);
		}
	};

	return {
		api,
		logger: createConsoleLogger({ level: "DEBUG" }),
		[INTERNAL]: {},
		verify,
	};
}

/**
 * Runs `fn` with a fresh fake client, then asserts every queued call was made.
 *
 * `verify()` runs only after `fn` resolves, so a failure inside `fn` propagates with its own
 * error — never masked by a verification error.
 *
 * @example
 * test("activates a schedule", () =>
 *   withFakeClient(async (client) => {
 *     client.api.schedule.activateV1.once(request, response);
 *     await schedule(params).activate(client, workflow, input);
 *   }));
 */
export async function withFakeClient<Context = null>(
	fn: (client: Omit<FakeClient<Context>, "verify">) => Promise<void> | void
): Promise<void> {
	const client = fakeClient<Context>();
	await fn(client);
	client.verify();
}
