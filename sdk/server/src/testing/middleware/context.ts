import { createConsoleLogger } from "@aikirun/lib/logger";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { Factory } from "fishery";
import { ulid } from "ulidx";

import type { NamespaceRequestContext } from "../../middleware/context";

export const namespaceRequestContextFactory = Factory.define<NamespaceRequestContext>(() => ({
	type: "request",
	traceId: ulid(),
	spanId: ulid(),
	logger: createConsoleLogger({ level: "ERROR" }),
	requestType: "authed",
	headers: new Headers(),
	method: "POST",
	url: "test://request",
	organizationId: "org" as OrganizationId,
	namespaceId: "ns" as NamespaceId,
}));
