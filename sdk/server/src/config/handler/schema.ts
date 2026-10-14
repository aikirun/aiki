import type { ConfigValidationResult } from "@aikirun/lib/config";
import type { DeepPartial } from "@aikirun/lib/object";
import { type } from "arktype";

import { validateAgainstSchema } from "../validate";

const serverHandlerConfigSchema = type({
	imminentRuns: {
		lookaheadWindowMs: "number.integer >= 0",
		overshootMs: "number.integer >= 0",
	},
});

export type ServerHandlerConfig = typeof serverHandlerConfigSchema.infer;

export type ServerHandlerConfigOverrides = DeepPartial<ServerHandlerConfig>;

export function validateServerHandlerConfig(config: ServerHandlerConfig): ConfigValidationResult {
	return validateAgainstSchema(serverHandlerConfigSchema, config);
}
