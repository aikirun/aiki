import { asConfigProvider, type CreateConfigProvider, dynamicConfigProvider } from "@aikirun/lib/config";
import { merge } from "@aikirun/lib/object";

import { defaultServerRuntimeConfig } from "./defaults";
import type { ServerRuntimeConfig, ServerRuntimeConfigOverrides } from "./schema";

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
 * without redeploying. The server starts on defaults with `initial` overrides applied.
 * `refresh` returns overrides too, and each refresh applies them on top of `initial`,
 * so a setting that `refresh` stops returning goes back to its `initial` or default value.
 * Every refresh runs in the background, and a failed refresh keeps the current snapshot.
 */
export function dynamicRuntimeConfigProvider(params: {
	initial?: ServerRuntimeConfigOverrides;
	refresh: () => ServerRuntimeConfigOverrides | Promise<ServerRuntimeConfigOverrides>;
	refreshIntervalMs: number;
}): CreateConfigProvider<ServerRuntimeConfig> {
	const initialConfig = merge(defaultServerRuntimeConfig, params.initial);
	return dynamicConfigProvider({
		initial: initialConfig,
		refresh: params.refresh,
		applyOverrides: (overrides) => merge(initialConfig, overrides),
		refreshIntervalMs: params.refreshIntervalMs,
	});
}
