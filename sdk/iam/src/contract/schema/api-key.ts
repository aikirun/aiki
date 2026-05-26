import { type } from "arktype";

export const apiKeyStatusSchema = type("'active' | 'revoked' | 'expired'");

export const apiKeyInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	keyPrefix: "string > 0",
	status: apiKeyStatusSchema,
	createdAt: "number > 0",
	expiresAt: "number > 0 | null",
});
export type ApiKeyInfo = typeof apiKeyInfoSchema.infer;
