export type { ConfigProvider, ConfigProviderContext, CreateConfigProvider } from "@aikirun/lib/config";
export { asConfigProvider } from "@aikirun/lib/config";
export type { DatabaseConfig, MysqlDatabaseConfig, PgDatabaseConfig, SqliteDatabaseConfig } from "@aikirun/lib/db";
export type { Logger } from "@aikirun/lib/logger";

export type { ServerRuntimeConfig, ServerRuntimeConfigOverrides } from "./config";
export { defaultServerRuntimeConfig, dynamicRuntimeConfigProvider, staticRuntimeConfigProvider } from "./config";
export { database } from "./infra/db";
export type { MigrateApplyParams } from "./migrate";
export { migrateApply } from "./migrate";
export type {
	Server,
	ServerParams,
	ServerRuntimeHandle,
	ServerRuntimeId,
	ServerRuntimeParams,
} from "./server";
export { server } from "./server";
