import { implement } from "@orpc/server";

import { handleError } from "./error-handler";
import type { OrganizationSessionRequestContext } from "../context";
import { organizationAuthedContract } from "../contract/organization-authed";

const baseOrganizationAuthedImplementer =
	implement(organizationAuthedContract).$context<OrganizationSessionRequestContext>();

const organizationAuthedErrorHandler = baseOrganizationAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (err) {
		handleError(context, err);
		throw err;
	}
});

export const organizationAuthedImplementer = baseOrganizationAuthedImplementer.use(organizationAuthedErrorHandler);
