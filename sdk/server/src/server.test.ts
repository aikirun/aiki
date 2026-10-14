import { noopLogger } from "@aikirun/lib/logger";
import type { CreateDatabase } from "@aikirun/types/infra/db";
import { describe, expect, test, vi } from "vitest";

import { server } from "./server";

describe("server handler", () => {
	const databaseError = new Error("database unavailable");

	function createUnavailableDatabase(): CreateDatabase {
		return Object.assign(
			vi.fn(async () => {
				throw databaseError;
			}),
			{ close: async () => {} }
		);
	}

	test("answers 500 when the handler cannot be created", async () => {
		const aikiServer = server({ db: createUnavailableDatabase(), logger: noopLogger });

		const response = await aikiServer.handler(new Request("http://localhost/api/workflowRun/getById"));

		expect([response.status, await response.text()]).toEqual([500, "Internal Server Error"]);
	});

	test("logs why the handler could not be created", async () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const aikiServer = server({ db: createUnavailableDatabase(), logger });

		await aikiServer.handler(new Request("http://localhost/api/workflowRun/getById"));

		expect(logger.error.mock.calls).toEqual([["Server handler creation failed", { err: databaseError }]]);
	});

	test("does not try to create the handler again on a later request", async () => {
		const unavailableDatabase = createUnavailableDatabase();
		const aikiServer = server({ db: unavailableDatabase, logger: noopLogger });

		await aikiServer.handler(new Request("http://localhost/api/workflowRun/getById"));
		await aikiServer.handler(new Request("http://localhost/api/workflowRun/getById"));

		expect(unavailableDatabase).toHaveBeenCalledTimes(1);
	});
});
