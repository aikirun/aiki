import { noopLogger } from "@aikirun/lib/logger";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { Factory } from "fishery";
import { ulid } from "ulidx";

import type { DaemonContext, NamespaceRequestContext } from "../../../middleware/context";

export const namespaceRequestContextFactory = Factory.define<NamespaceRequestContext>(() => ({
	type: "request",
	traceId: ulid(),
	spanId: ulid(),
	logger: noopLogger,
	requestType: "authed",
	headers: new Headers(),
	method: "POST",
	url: "test://request",
	organizationId: ulid() as OrganizationId,
	namespaceId: ulid() as NamespaceId,
}));

export const daemonContextFactory = Factory.define<DaemonContext>(() => ({
	type: "daemon",
	traceId: ulid(),
	spanId: ulid(),
	logger: noopLogger,
	name: "test",
	signal: new AbortController().signal,
}));
