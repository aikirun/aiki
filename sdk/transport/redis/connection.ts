import type { Logger } from "@aikirun/types/logger";
import type { Redis } from "ioredis";

export interface RedisConnectionParams {
	host: string;
	port: number;
	password?: string;
	db?: number;
	connectTimeoutMs?: number;
}

interface RedisConnectionSupervisorOptions {
	logger?: Logger;
}

/**
 * Attaches connection-lifecycle supervision to an existing Redis client. The
 * client is expected to already be configured in fail-fast mode.
 * Adds a supervisor over the "connect → ready" handshake and forces a reconnect
 * if that handshake stalls.
 */
export function attachConnectionSupervisor(redis: Redis, options?: RedisConnectionSupervisorOptions) {
	const logger = options?.logger;

	type State =
		| { status: "disconnected" }
		| { status: "awaiting_ready"; supervisor: ReturnType<typeof setTimeout> }
		| { status: "connected" }
		| { status: "closed" };

	let currentState: State = { status: "disconnected" };

	const onReadyHandshakeStalled = () => {
		logger?.warn("Redis connect handshake stalled, forcing reconnect");
		redis.disconnect(true);
	};

	const transitionTo = (nextStatus: State["status"]) => {
		if (currentState.status === "closed") {
			return;
		}
		if (currentState.status === "awaiting_ready") {
			clearTimeout(currentState.supervisor);
		}
		if (nextStatus === "awaiting_ready") {
			currentState = {
				status: "awaiting_ready",
				supervisor: setTimeout(onReadyHandshakeStalled, redis.options.connectTimeout),
			};
		} else {
			currentState = { status: nextStatus };
		}
	};

	const onError = () => {};
	const onConnect = () => transitionTo("awaiting_ready");
	const onReady = () => transitionTo("connected");
	const onClose = () => transitionTo("disconnected");

	redis.on("error", onError);
	redis.on("connect", onConnect);
	redis.on("ready", onReady);
	redis.on("close", onClose);

	return {
		detach() {
			transitionTo("closed");
			redis.off("error", onError);
			redis.off("connect", onConnect);
			redis.off("ready", onReady);
			redis.off("close", onClose);
		},
	};
}
