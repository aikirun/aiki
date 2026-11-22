import type { RequestContextBase } from "@aikirun/lib/context";
import { implement } from "@orpc/server";

import { handleError } from "./error-handler";
import {
	createOrganizationSessionRequestContext,
	type OrganizationDashboardAuthorization,
	type OrganizationSessionRequestContext,
} from "../context";
import { organizationAuthedContract } from "../contract/organization-authed";

const baseOrganizationAuthedRouterImplementer = implement(organizationAuthedContract).$context<
	RequestContextBase & { authorize: () => Promise<OrganizationDashboardAuthorization> }
>();

const organizationAuthedRouterErrorHandler = baseOrganizationAuthedRouterImplementer.middleware(
	async ({ context, next }) => {
		try {
			return await next({ context });
		} catch (err) {
			handleError(context, err);
			throw err;
		}
	}
);

const organizationAuthedRouterAuthorization = baseOrganizationAuthedRouterImplementer.middleware(
	async ({ context, next }) => {
		const { authorize, ...requestContext } = context;
		return next({
			context: createOrganizationSessionRequestContext({ context: requestContext, authorization: await authorize() }),
		});
	}
);

export const organizationAuthedRouterImplementer = baseOrganizationAuthedRouterImplementer
	.use(organizationAuthedRouterErrorHandler)
	.use(organizationAuthedRouterAuthorization);
export const organizationAuthedProcedureImplementer =
	implement(organizationAuthedContract).$context<OrganizationSessionRequestContext>();
