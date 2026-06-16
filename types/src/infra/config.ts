import type { Logger } from "@aikirun/lib/logger";
import type { PathFromObject, TypeOfValueAtPath } from "@aikirun/lib/object";

export interface ConfigProvider<Config extends object> {
	get<Path extends PathFromObject<Config>>(path: Path): TypeOfValueAtPath<Config, Path>;
	stop?(): void;
}

export interface ConfigProviderContext {
	logger: Logger;
}

export type CreateConfigProvider<Config extends object> = (
	context: ConfigProviderContext
) => ConfigProvider<Config> | Promise<ConfigProvider<Config>>;
