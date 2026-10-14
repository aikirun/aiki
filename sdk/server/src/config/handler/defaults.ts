import type { ServerHandlerConfig } from "./schema";

export const defaultServerHandlerConfig: ServerHandlerConfig = {
	imminentRuns: {
		lookaheadWindowMs: 30_000,
		overshootMs: 30,
	},
};
