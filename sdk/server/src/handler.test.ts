import { UnauthorizedError } from "@aikirun/lib/error";
import { SENTINEL_ULID } from "@aikirun/lib/id";
import { noopLogger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";

import { createHandler } from "./handler";
import { describe, expect, test } from "bun:test";

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
		const response = await handler(
			new Request("http://localhost/api/identity/getV1", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: {} }),
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			json: { organizationId: "org-authenticated", namespaceId: "ns-authenticated" },
		});
	});

	test("returns the default identity without IAM", async () => {
		const handler = await createHandler({ db: {} as Database, logger: noopLogger });
		const response = await handler(
			new Request("http://localhost/api/identity/getV1", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: {} }),
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ json: { organizationId: SENTINEL_ULID, namespaceId: SENTINEL_ULID } });
	});
});
