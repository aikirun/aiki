import { handleError } from "@aikirun/server/internal/router";
import { implement } from "@orpc/server";

import type { OrganizationSessionRequestContext } from "../context";
import { organizationAuthedContract } from "../contract/organization-authed";

const baseOrganizationAuthedImplementer =
	implement(organizationAuthedContract).$context<OrganizationSessionRequestContext>();

const organizationAuthedErrorHandler = baseOrganizationAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		handleError(context, error);
		throw error;
	}
});

export const organizationAuthedImplementer = baseOrganizationAuthedImplementer.use(organizationAuthedErrorHandler);
