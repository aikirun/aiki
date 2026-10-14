import type { ConfigValidationResult } from "@aikirun/lib/config";
import { type Type, type } from "arktype";

export function validateAgainstSchema(schema: Type, config: unknown): ConfigValidationResult {
	const result = schema(config);
	if (result instanceof type.errors) {
		return { valid: false, reason: result.map((error) => error.message).join("; ") };
	}
	return { valid: true };
}
