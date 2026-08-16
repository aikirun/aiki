import type { DeepPartial } from "@aikirun/lib/object";

export interface ServerHandlerConfig {
	imminentRuns: {
		lookaheadWindowMs: number;
	};
}

export type ServerHandlerConfigOverrides = DeepPartial<ServerHandlerConfig>;

export const defaultServerHandlerConfig: ServerHandlerConfig = {
	imminentRuns: {
		lookaheadWindowMs: 30_000,
	},
};
