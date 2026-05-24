import { implement } from "@orpc/server";

import { handleError } from "../../router/error-handler";
import { organizationAuthedContract } from "../contract/organization-authed";
import type { OrganizationSessionRequestContext } from "../organization-context";

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
