import { type } from "arktype";

export const namespaceRoleSchema = type("'admin' | 'member' | 'viewer'");

export const namespaceInfoSchema = type({
	id: "string",
	name: "string",
	role: namespaceRoleSchema,
	createdAt: "number > 0",
});
export type NamespaceInfo = typeof namespaceInfoSchema.infer;

export const namespaceMemberInputSchema = type({
	userId: "string > 0",
	role: namespaceRoleSchema,
});
export type NamespaceMemberInput = typeof namespaceMemberInputSchema.infer;

export const namespaceMemberInfoSchema = type({
	userId: "string",
	"name?": "string > 0 | undefined",
	email: "string",
	role: namespaceRoleSchema,
});
export type NamespaceMemberInfo = typeof namespaceMemberInfoSchema.infer;
