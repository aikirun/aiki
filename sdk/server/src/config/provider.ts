import { delay, fireAndForget } from "@aikirun/lib/async";
import { withRetry } from "@aikirun/lib/retry";
import type { CreateConfigProvider } from "@aikirun/types/infra/config";

import { parseServerConfig, type ServerConfig, type ServerConfigOverrides } from "./runtime";

/**
 * Config fixed at startup — the server's default when no `config` is supplied.
 * Pass `overrides` to change any setting; omit them for the defaults.
 */
export function staticConfigProvider(overrides?: ServerConfigOverrides): CreateConfigProvider<ServerConfig> {
	return () => ({
		config: parseServerConfig(overrides ?? {}),
	});
}

/**
 * Config that reloads on a timer, letting an operator retune a running server
 * without redeploying. `refresh` receives the current config and returns the next.
 * The first load runs before the provider is returned; after that, a failed refresh
 * is logged and the previous config kept.
 */
export function dynamicConfigProvider(params: {
	refreshIntervalMs: number;
	refresh: (current: ServerConfig) => ServerConfig | Promise<ServerConfig>;
}): CreateConfigProvider<ServerConfig> {
	return async ({ logger }) => {
		let config = parseServerConfig({});
		const abortController = new AbortController();
		const { signal } = abortController;

		const refreshConfig = async (): Promise<void> => {
			const response = params.refresh(config);
			const newConfig: ServerConfig = response instanceof Promise ? await response : response;
			config = parseServerConfig(newConfig);
		};

		await refreshConfig();

		const refreshConfigLoop = async (): Promise<void> => {
			while (!signal.aborted) {
				await delay(params.refreshIntervalMs, { signal }).catch(() => {});
				if (signal.aborted) {
					break;
				}
				await withRetry(
					refreshConfig,
					{ type: "jittered", maxAttempts: Number.POSITIVE_INFINITY, baseDelayMs: 1_000, maxDelayMs: 30_000 },
					{
						signal,
						onError: (err) => {
							if (signal.aborted) {
								return;
							}
							logger.warn("Config refresh failed, keeping last-good", { err });
						},
					}
				).run();
			}
		};

		fireAndForget(refreshConfigLoop(), (err) => {
			logger.error("Config refresh loop stopped", { err });
		});

		return {
			get config() {
				return config;
			},
			stop() {
				abortController.abort();
			},
		};
	};
}
