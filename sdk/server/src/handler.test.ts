import { UnauthorizedError } from "@aikirun/lib/error";
import { SENTINEL_ULID } from "@aikirun/lib/id";
import { noopLogger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { describe, expect, test } from "vitest";

import { createHandler } from "./handler";
import { createNamespaceAuthedClient } from "./testing/client";

// iam ships as its own bundle with its own copy of the lib error classes, so the error its
// authorizer throws is never built by the constructor this package imports. This stands in
// for that error: same shape and code, different constructor.
class UnauthorizedErrorFromIamBundle extends Error {
	readonly code = "UNAUTHORIZED";
	readonly status = 401;

	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

// Authorization runs before the router and answers its errors in plain text, not in oRPC's JSON.
// The oRPC client can't read plain text, so these tests send raw requests.
describe("handler API authorization", () => {
	function handlerWithFailingAuthorizer(err: unknown) {
		return createHandler({
			db: {} as Database,
			logger: noopLogger,
			iam: {
				api: () => () => {
					throw err;
				},
			},
		});
	}

	test("an unauthorized error from iam bundle answers 401", async () => {
		const err = new UnauthorizedErrorFromIamBundle("Invalid API key");
		expect(err instanceof UnauthorizedError).toBe(false);

		const handler = await handlerWithFailingAuthorizer(err);
		const response = await handler(new Request("http://localhost/api/workflowRun/getById"));

		expect([response.status, await response.text()]).toEqual([401, "Invalid API key"]);
	});

	test("an error carrying no reporting details answers 500", async () => {
		const handler = await handlerWithFailingAuthorizer(new Error("boom"));
		const response = await handler(new Request("http://localhost/api/workflowRun/getById"));

		expect([response.status, await response.text()]).toEqual([500, "Internal Server Error"]);
	});
});

describe("handler config", () => {
	test("does not create the handler when a setting is invalid", async () => {
		const creating = createHandler({
			db: {} as Database,
			logger: noopLogger,
			config: { imminentRuns: { lookaheadWindowMs: -30_000 } },
		});

		await expect(creating).rejects.toThrow(/^Invalid config: imminentRuns\.lookaheadWindowMs [^;]+$/);
	});
});

describe("handler input validation", () => {
	test("an invalid request answers 400 naming each invalid field", async () => {
		const handler = await createHandler({ db: {} as Database, logger: noopLogger });
		const api = createNamespaceAuthedClient(handler);

		await expect(
			api.schedule.activateV1({
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInputHash: { value: "input-hash" },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 0 },
				workflowRunOptions: { retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 100, factor: 0.5 } },
			})
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			status: 400,
			message: expect.stringMatching(
				/^Input validation failed: spec\.everyMs [^;]+; workflowRunOptions\.retry\.factor [^;]+$/
			),
		});
	});
});

describe("identity API", () => {
	test("returns the namespace and organization from authenticated credentials", async () => {
		const handler = await createHandler({
			db: {} as Database,
			logger: noopLogger,
			iam: {
				api: () => () => ({
					organizationId: "org-authenticated" as OrganizationId,
					namespaceId: "ns-authenticated" as NamespaceId,
				}),
			},
		});
		const api = createNamespaceAuthedClient(handler);

		expect(await api.identity.getV1({})).toEqual({
			organizationId: "org-authenticated",
			namespaceId: "ns-authenticated",
		});
	});

	test("returns the default identity without IAM", async () => {
		const handler = await createHandler({ db: {} as Database, logger: noopLogger });
		const api = createNamespaceAuthedClient(handler);

		expect(await api.identity.getV1({})).toEqual({ organizationId: SENTINEL_ULID, namespaceId: SENTINEL_ULID });
	});
});
