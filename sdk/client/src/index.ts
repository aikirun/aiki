export type { ConsoleLoggerOptions, Logger } from "@aikirun/lib/logger";
export { createConsoleLogger as consoleLogger } from "@aikirun/lib/logger";
export type {
	ApiClient,
	Client,
	ClientParams,
	EmbeddedClientParams,
	RemoteClientParams,
} from "@aikirun/types/client";

export { client } from "./client";
