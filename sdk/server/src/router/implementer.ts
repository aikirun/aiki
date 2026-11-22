import type { PublicRequestContext, RequestContextBase } from "@aikirun/lib/context";
import type { ApiAuthorization } from "@aikirun/types/iam";
import { implement } from "@orpc/server";

import { handleError } from "./error-handler";
import { namespaceAuthedContract } from "../contract/namespace-authed";
import { publicContract } from "../contract/public";
import { createNamespaceRequestContext, type NamespaceRequestContext } from "../middleware/context";

const basePublicImplementer = implement(publicContract).$context<PublicRequestContext>();
const baseNamespaceAuthedRouterImplementer = implement(namespaceAuthedContract).$context<
	RequestContextBase & { authorize: () => ApiAuthorization | Promise<ApiAuthorization> }
>();

const publicErrorHandler = basePublicImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (err) {
		handleError(context, err);
		throw err;
	}
});

const namespaceAuthedRouterErrorHandler = baseNamespaceAuthedRouterImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (err) {
		handleError(context, err);
		throw err;
	}
});

const namespaceAuthedRouterAuthorization = baseNamespaceAuthedRouterImplementer.middleware(
	async ({ context, next }) => {
		const { authorize, ...requestContext } = context;
		const authorization = authorize();
		return next({
			context: createNamespaceRequestContext({
				context: requestContext,
				authorization: authorization instanceof Promise ? await authorization : authorization,
			}),
		});
	}
);

export const publicImplementer = basePublicImplementer.use(publicErrorHandler);
export const namespaceAuthedRouterImplementer = baseNamespaceAuthedRouterImplementer
	.use(namespaceAuthedRouterErrorHandler)
	.use(namespaceAuthedRouterAuthorization);
export const namespaceAuthedProcedureImplementer =
	implement(namespaceAuthedContract).$context<NamespaceRequestContext>();
