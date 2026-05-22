import { type } from "arktype";

export const apiKeyInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	keyPrefix: "string > 0",
	status: "'active' | 'revoked' | 'expired'",
	createdAt: "number > 0",
	expiresAt: "number > 0 | null",
});
