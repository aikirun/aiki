import { asConfigProvider, type CreateConfigProvider, dynamicConfigProvider } from "@aikirun/lib/config";
import { merge } from "@aikirun/lib/object";

import { defaultServerRuntimeConfig } from "./defaults";
import { migrateDeprecatedConfigKeys, serverRuntimeConfigDeprecations } from "./deprecated-config";
import type { ServerRuntimeConfig, ServerRuntimeConfigOverrides } from "./schema";

/**
 * Config fixed at startup. Pass `overrides` to change any setting; omit them for
 * the defaults.
 */
export function staticRuntimeConfigProvider(
	overrides?: ServerRuntimeConfigOverrides
): CreateConfigProvider<ServerRuntimeConfig> {
	return ({ logger }) => {
		const config = merge(
			defaultServerRuntimeConfig,
			migrateDeprecatedConfigKeys({ overrides, deprecations: serverRuntimeConfigDeprecations, logger })
		);
		return asConfigProvider(() => config);
	};
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
	return (context) => {
		const { logger } = context;
		const initialConfig = merge(
			defaultServerRuntimeConfig,
			migrateDeprecatedConfigKeys({
				overrides: params.initial,
				deprecations: serverRuntimeConfigDeprecations,
				logger,
			})
		);
		return dynamicConfigProvider({
			initial: initialConfig,
			refresh: params.refresh,
			applyOverrides: (overrides) =>
				merge(
					initialConfig,
					migrateDeprecatedConfigKeys({ overrides, deprecations: serverRuntimeConfigDeprecations, logger })
				),
			refreshIntervalMs: params.refreshIntervalMs,
		})(context);
	};
}
