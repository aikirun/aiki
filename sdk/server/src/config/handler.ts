import type { DeepPartial } from "@aikirun/lib/object";

export interface ServerHandlerConfig {
	imminentRuns: {
		lookaheadWindowMs: number;
		overshootMs: number;
	};
}

export type ServerHandlerConfigOverrides = DeepPartial<ServerHandlerConfig>;

export const defaultServerHandlerConfig: ServerHandlerConfig = {
	imminentRuns: {
		lookaheadWindowMs: 30_000,
		overshootMs: 30,
	},
};
