import { type } from "arktype";

export type { NamespaceApi, NamespaceInfo } from "@aikirun/types/namespace-api";

export const namespaceRoleSchema = type("'admin' | 'member' | 'viewer'");

export const namespaceInfoSchema = type({
	id: "string",
	name: "string",
	role: "'admin' | 'member' | 'viewer'",
	createdAt: "number > 0",
});

export const namespaceMemberInfoSchema = type({
	userId: "string",
	"name?": "string > 0 | undefined",
	email: "string",
	role: namespaceRoleSchema,
});
