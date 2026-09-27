import { asConfigProvider, type CreateConfigProvider, dynamicConfigProvider } from "@aikirun/lib/config";
import { merge } from "@aikirun/lib/object";

import { defaultServerRuntimeConfig, type ServerRuntimeConfig, type ServerRuntimeConfigOverrides } from "./runtime";

/**
 * Config fixed at startup. Pass `overrides` to change any setting; omit them for
 * the defaults.
 */
export function staticRuntimeConfigProvider(
	overrides?: ServerRuntimeConfigOverrides
): CreateConfigProvider<ServerRuntimeConfig> {
	const config = merge(defaultServerRuntimeConfig, overrides);
	return () => asConfigProvider(() => config);
}

/**
 * Config that reloads on a timer, letting an operator retune a running server
 * without redeploying. `refresh` receives the current config and returns the next.
 * The server starts on defaults with `initial` overrided applied.
 * Every refresh runs in the background, and a failed refresh keeps the current snapshot.
 */
export function dynamicRuntimeConfigProvider(params: {
	initial?: ServerRuntimeConfigOverrides;
	refresh: (current: ServerRuntimeConfig) => ServerRuntimeConfig | Promise<ServerRuntimeConfig>;
	refreshIntervalMs: number;
}): CreateConfigProvider<ServerRuntimeConfig> {
	return dynamicConfigProvider({
		initial: merge(defaultServerRuntimeConfig, params.initial),
		refresh: params.refresh,
		refreshIntervalMs: params.refreshIntervalMs,
	});
}
