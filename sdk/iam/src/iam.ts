import type { Iam } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { CreateDatabase } from "@aikirun/types/infra/db";

import { apiAuthorizer } from "./api-authorizer";
import { dashboardSessionIam } from "./dashboard-session";

export interface IamParams {
	db: CreateDatabase;
	secret: string;
	baseURL: string;
	trustedOrigins: string[];
	cache?: CreateCache;
}

function iamFn(params: IamParams): Iam {
	return {
		api: apiAuthorizer(params),
		dashboard: dashboardSessionIam(params),
	};
}

export const iam = Object.assign(iamFn, {
	api: apiAuthorizer,
	dashboard: dashboardSessionIam,
});
