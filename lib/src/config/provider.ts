import { delay, fireAndForget } from "../async";
import type { Logger } from "../logger";
import { withRetry } from "../retry";

export interface ConfigProvider<Config> {
	readonly config: Config;
	scope<Key extends keyof Config>(key: Key): ConfigProvider<Config[Key]>;
}

export interface ConfigProviderContext {
	logger: Logger;
	signal: AbortSignal;
}

export type PassiveConfigProviderContext = Omit<ConfigProviderContext, "signal">;

export type CreateConfigProvider<Config> = (context: ConfigProviderContext) => ConfigProvider<Config>;

export type CreatePassiveConfigProvider<Config> = (context: PassiveConfigProviderContext) => ConfigProvider<Config>;

/**
 * Wraps a snapshot read into a `ConfigProvider`:
 * `config` returns the latest value and
 * `scope` narrows to a sub-key, both lazily through `read`.
 */
export const asConfigProvider = <Config>(read: () => Config): ConfigProvider<Config> => ({
	get config() {
		return read();
	},
	scope(key) {
		return asConfigProvider(() => read()[key]);
	},
});

/**
 * A config provider that starts on initial value and refreshes it in the background.
 * A failed refresh retains the current snapshot and retries with backoff.
 * The loop runs off the context signal and stops when it aborts.
 */
export function dynamicConfigProvider<Config>(params: {
	initial: Config;
	refresh: (current: Config) => Config | Promise<Config>;
	refreshIntervalMs: number;
}): CreateConfigProvider<Config> {
	const { initial, refresh, refreshIntervalMs } = params;

	return ({ logger, signal }) => {
		let config = initial;

		const refreshConfig = async (): Promise<void> => {
			const response = refresh(config);
			config = response instanceof Promise ? await response : response;
		};

		const refreshConfigLoop = async (): Promise<void> => {
			while (!signal.aborted) {
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
				await delay(refreshIntervalMs, { signal }).catch(() => {});
			}
		};

		fireAndForget(refreshConfigLoop(), (err) => {
			logger.error("Config refresh loop stopped", { err });
		});

		return asConfigProvider(() => config);
	};
}
