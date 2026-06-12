import type { PublicRequestContext } from "@aikirun/lib/context";
import { implement } from "@orpc/server";

import { handleError } from "./error-handler";
import { namespaceAuthedContract } from "../contract/namespace-authed";
import { publicContract } from "../contract/public";
import type { NamespaceRequestContext } from "../middleware/context";

const basePublicImplementer = implement(publicContract).$context<PublicRequestContext>();
const baseNamespaceAuthedImplementer = implement(namespaceAuthedContract).$context<NamespaceRequestContext>();

const publicErrorHandler = basePublicImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (err) {
		handleError(context, err);
		throw err;
	}
});

const namespaceAuthedErrorHandler = baseNamespaceAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (err) {
		handleError(context, err);
		throw err;
	}
});

export const publicImplementer = basePublicImplementer.use(publicErrorHandler);
export const namespaceAuthedImplementer = baseNamespaceAuthedImplementer.use(namespaceAuthedErrorHandler);
