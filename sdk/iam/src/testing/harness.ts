import { loadDatabaseConfig } from "@aikirun/lib/db";
import { noopLogger } from "@aikirun/lib/logger";
import { database } from "@aikirun/server";
import type { ApiAuthorizer, DashboardIam } from "@aikirun/types/iam";
import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { resetDatabase } from "./infra/db/reset";
import { iam } from "../iam";

const BASE_URL = "http://localhost:9850";
const DASHBOARD_ORIGIN = "http://localhost:9851";

export interface IamHarnessDeps {
	/** Where the IAM handlers are served, as the requests a test sends must address them. */
	baseURL: string;
	/** The one origin the IAM handlers trust. */
	dashboardOrigin: string;
	dashboardIam: DashboardIam;
	authorizeApiRequest: ApiAuthorizer;
}

/**
 * Stands up one pooled connection against the database and the IAM handlers on top of it, resets
 * every IAM table before each test, and closes the connection afterwards.
 * The returned function runs a test body with the handlers a deployment exposes: the dashboard's
 * authenticator and organization handler, and the authorizer for API requests.
 *
 * It is provider-blind — it works against whatever `DATABASE_PROVIDER` points to, going through
 * the same `Database` seam as production.
 *
 * @example
 * const withHarness = createIamHarness();
 * test("lets a viewer of a namespace use it", () =>
 *   withHarness(async (deps) => { ... }));
 */
export function createIamHarness() {
	let createDb: CreateDatabase | undefined;
	let db: Database | undefined;
	let deps: IamHarnessDeps | undefined;

	beforeAll(async () => {
		createDb = database(loadDatabaseConfig(), { logger: noopLogger });
		db = await createDb();
		const iamParams = {
			db: createDb,
			secret: "a-secret-used-only-by-tests",
			baseURL: BASE_URL,
			trustedOrigins: [DASHBOARD_ORIGIN],
		};
		deps = {
			baseURL: BASE_URL,
			dashboardOrigin: DASHBOARD_ORIGIN,
			dashboardIam: iam.dashboard(iamParams)({ logger: noopLogger }),
			authorizeApiRequest: iam.api(iamParams)({ logger: noopLogger }),
		};
	});

	beforeEach(async () => {
		if (db) {
			await resetDatabase(db);
		}
	});

	afterAll(async () => {
		await createDb?.close();
	});

	return async (fn: (deps: IamHarnessDeps) => Promise<void>) => {
		if (!deps) {
			throw new Error("Harness deps are only available inside a test — call the returned function in a test body.");
		}
		await fn(deps);
	};
}
