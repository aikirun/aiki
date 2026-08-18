import { UnauthorizedError } from "@aikirun/lib/error";
import { noopLogger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";

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
