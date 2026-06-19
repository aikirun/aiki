import type { Logger } from "@aikirun/lib/logger";

export interface ConfigProvider<Config> {
	readonly config: Config;
	stop?(): void;
}

export interface ConfigProviderContext {
	logger: Logger;
}

export type CreateConfigProvider<Config> = (
	context: ConfigProviderContext
) => ConfigProvider<Config> | Promise<ConfigProvider<Config>>;
