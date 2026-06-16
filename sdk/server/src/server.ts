import { ConsoleLogger, type Logger } from "@aikirun/lib/logger";
import type { Iam } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { CreateConfigProvider } from "@aikirun/types/infra/config";
import type { CreateDatabase } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";

import type { ServerConfig } from "./config";

export interface ServerRuntimeParams {
	publisher?: CreatePublisher;
	timerPriorityQueue?: CreateTimerPriorityQueue;
	config?: CreateConfigProvider<ServerConfig>;
}

export interface ServerParams {
	db: CreateDatabase;
	iam?: Iam;
	cache?: CreateCache;
	logger?: Logger;
	runtime?: ServerRuntimeParams;
}

export type ServerRuntimeId = string & { _brand: "runtime_id" };

export interface ServerRuntimeHandle {
	id: ServerRuntimeId;
	stop: () => Promise<void>;
}

export interface Server {
	handler: (request: Request) => Promise<Response>;
	runtime: { start: () => Promise<ServerRuntimeHandle> };
}

export function server(params: ServerParams): Server {
	const logger: Logger = params.logger ?? new ConsoleLogger();

	let handler: Server["handler"] | undefined;
	let createHandlerPromise: Promise<Server["handler"]> | undefined;

	return {
		handler: (request) => {
			if (handler) return handler(request);
			return (async () => {
				createHandlerPromise ??= (async () => {
					const db = await params.db();
					const { createHandler } = await import("./handler");
					return createHandler({ db, logger, iam: params.iam, cache: params.cache });
				})();
				handler = await createHandlerPromise;
				return handler(request);
			})();
		},
		runtime: {
			async start(): Promise<ServerRuntimeHandle> {
				const db = await params.db();
				const { createRuntime } = await import("./runtime");
				return createRuntime({ db, logger, runtime: params.runtime }).start();
			},
		},
	};
}
