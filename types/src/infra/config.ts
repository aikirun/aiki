import type { Logger } from "@aikirun/lib/logger";

export interface ConfigProvider<Config> {
	readonly config: Config;
}

export interface ConfigProviderContext {
	logger: Logger;
	signal: AbortSignal;
}

export type CreateConfigProvider<Config> = (
	context: ConfigProviderContext
) => ConfigProvider<Config> | Promise<ConfigProvider<Config>>;
