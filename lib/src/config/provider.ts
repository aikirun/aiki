import type { ConfigValidationResult } from "./validation";
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

type ConfigValidationOutcome = { valid: true } | { valid: false; reason: string; err?: unknown };

type ValidatedConfigState<Config> =
	| { type: "valid"; config: Config }
	| { type: "invalid"; rejectedConfig: Config; lastValidConfig: Config };

/**
 * Wraps a provider so that it never hands out a config that `validate` rejects.
 * It throws when the provider's first config is invalid. When a later config is invalid,
 * it keeps handing out the last valid one. A `validate` that throws rejects the config too.
 */
export function validatedConfigProvider<Config>(params: {
	provider: ConfigProvider<Config>;
	validate: (config: Config) => ConfigValidationResult;
	logger: Logger;
}): ConfigProvider<Config> {
	const { provider, logger } = params;

	const validate = (config: Config): ConfigValidationOutcome => {
		try {
			return params.validate(config);
		} catch (err) {
			return { valid: false, reason: `the validation threw ${String(err)}`, err };
		}
	};

	const initialConfig = provider.config;
	const initialResult = validate(initialConfig);
	if (!initialResult.valid) {
		const invalidConfigError = new Error(`Invalid config: ${initialResult.reason}`);
		if (initialResult.err !== undefined) {
			invalidConfigError.cause = initialResult.err;
		}
		throw invalidConfigError;
	}

	let state: ValidatedConfigState<Config> = { type: "valid", config: initialConfig };

	return asConfigProvider(() => {
		const { config } = provider;
		switch (state.type) {
			case "valid": {
				if (config === state.config) {
					return state.config;
				}
				const result = validate(config);
				if (result.valid) {
					state = { type: "valid", config };
					return config;
				}
				const logMeta: Record<string, unknown> = { "aiki.reason": result.reason };
				if (result.err !== undefined) {
					logMeta.err = result.err;
				}
				logger.error("Config is invalid, keeping last-good", logMeta);
				state = { type: "invalid", rejectedConfig: config, lastValidConfig: state.config };
				return state.lastValidConfig;
			}
			case "invalid": {
				if (config === state.rejectedConfig) {
					return state.lastValidConfig;
				}
				const result = validate(config);
				if (result.valid) {
					state = { type: "valid", config };
					return config;
				}
				state = { type: "invalid", rejectedConfig: config, lastValidConfig: state.lastValidConfig };
				return state.lastValidConfig;
			}
			default:
				return state satisfies never;
		}
	});
}
