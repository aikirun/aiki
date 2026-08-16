import { settleWithin } from "@aikirun/lib/async";
import type { CreateConfigProvider, CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { createConsoleLogger, type Logger } from "@aikirun/lib/logger";
import type { Iam } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { CreateDatabase } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";
import { ulid } from "ulidx";

import type {
	ServerHandlerConfig,
	ServerHandlerConfigOverrides,
	ServerRuntimeConfig,
	ServerRuntimeConfigOverrides,
} from "./config";

export interface ServerHandlerParams {
	iam?: Iam;
	cache?: CreateCache;
	config?: ServerHandlerConfigOverrides | CreatePassiveConfigProvider<ServerHandlerConfig>;
}

export interface ServerRuntimeParams {
	publisher?: CreatePublisher;
	config?: ServerRuntimeConfigOverrides | CreateConfigProvider<ServerRuntimeConfig>;
}

export interface ServerParams {
	db: CreateDatabase;
	logger?: Logger;
	timerPriorityQueue?: CreateTimerPriorityQueue;
	handler?: ServerHandlerParams;
	runtime?: ServerRuntimeParams;
}

export type ServerRuntimeId = string & { _brand: "runtime_id" };

export interface ServerRuntimeHandle {
	id: ServerRuntimeId;
	stop: () => Promise<void>;
}

export interface Server {
	handler: (request: Request) => Promise<Response>;
	runtime: { start: () => ServerRuntimeHandle };
}

export function server(params: ServerParams): Server {
	const logger = params.logger ?? createConsoleLogger();

	let handler: Server["handler"] | undefined;
	let createHandlerPromise: Promise<Server["handler"]> | undefined;

	return {
		handler: (request) => {
			if (handler) {
				return handler(request);
			}
			return (async () => {
				createHandlerPromise ??= (async () => {
					const db = await params.db();
					const { createHandler } = await import("./handler");
					return createHandler({
						db,
						logger,
						iam: params.handler?.iam,
						cache: params.handler?.cache,
						timerPriorityQueue: params.timerPriorityQueue,
						config: params.handler?.config,
					});
				})();
				handler = await createHandlerPromise;
				return handler(request);
			})();
		},
		runtime: {
			start(): ServerRuntimeHandle {
				return createRuntimeHandle({
					db: params.db,
					logger,
					timerPriorityQueue: params.timerPriorityQueue,
					runtime: params.runtime,
				});
			},
		},
	};
}

function createRuntimeHandle(params: {
	db: CreateDatabase;
	logger: Logger;
	timerPriorityQueue?: CreateTimerPriorityQueue;
	runtime?: ServerRuntimeParams;
}): ServerRuntimeHandle {
	const { logger } = params;
	const abortController = new AbortController();

	const startRuntimePromise = (async () => {
		try {
			const db = await params.db();
			const { startRuntime } = await import("./runtime");
			return await startRuntime({
				db,
				logger,
				signal: abortController.signal,
				publisher: params.runtime?.publisher,
				timerPriorityQueue: params.timerPriorityQueue,
				config: params.runtime?.config,
			});
		} catch (err) {
			logger.error("Server runtime failed to start", { err });
			return undefined;
		}
	})();

	const id = ulid() as ServerRuntimeId;

	let stopPromise: Promise<void> | undefined;

	const _stop = async (): Promise<void> => {
		abortController.abort();

		const startedRuntime = await startRuntimePromise;
		if (!startedRuntime) {
			return;
		}

		const gracefulShutdownTimeoutMs = startedRuntime.configProvider.config.gracefulShutdownTimeoutMs;
		if (gracefulShutdownTimeoutMs <= 0) {
			return;
		}

		const drained = await settleWithin(startedRuntime.daemonsPromise, gracefulShutdownTimeoutMs);
		if (!drained) {
			logger.warn("Runtime did not shut down within graceful timeout", {
				"aiki.runtimeId": id,
				"aiki.gracefulShutdownTimeoutMs": gracefulShutdownTimeoutMs,
			});
		}
	};

	return {
		id,
		stop(): Promise<void> {
			stopPromise ??= _stop();
			return stopPromise;
		},
	};
}
