import type { Logger } from "@aikirun/lib/logger";
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

interface RedisConnectionTracker {
	isAvailable(): boolean;
	assertIsAvailable(): void;
}

/**
 * Tracks whether a connection is usable right now by listening to it:
 * "close" means the connection dropped, "ready" means it works.
 *
 * One failure emits no events at all: a connect accepted by something dead —
 * e.g. a stopped container's forwarded port — that never answers. The
 * connection then just waits, and the optimistic starting verdict would never
 * be corrected. The grace check covers it: if no "ready" has arrived within
 * the connection's own connect timeout, stop assuming it is fine.
 *
 * The listeners only observe — the connection is never configured or acted on.
 */
function createConnectionTracker(redis: Redis): RedisConnectionTracker {
	const readyGraceMs = redis.options.connectTimeout ?? 10_000;
	const { status } = redis;
	let available = status !== "reconnecting" && status !== "close" && status !== "end";
	let lastReadyObservedAt = Date.now();

	redis.on("ready", () => {
		available = true;
		lastReadyObservedAt = Date.now();
	});
	redis.on("close", () => {
		available = false;
	});

	const isAvailable = () => {
		if (available && redis.status !== "ready" && Date.now() - lastReadyObservedAt > readyGraceMs) {
			available = false;
		}
		return available;
	};

	return {
		isAvailable,
		assertIsAvailable() {
			if (!isAvailable()) {
				throw new Error("Redis connection unavailable");
			}
		},
	};
}

export const connectionTracker = (() => {
	const trackers = new WeakMap<Redis, RedisConnectionTracker>();
	return (redis: Redis): RedisConnectionTracker => {
		let tracker = trackers.get(redis);
		if (!tracker) {
			tracker = createConnectionTracker(redis);
			trackers.set(redis, tracker);
		}
		return tracker;
	};
})();

/**
 * Attaches connection-lifecycle supervision to an existing Redis client: a
 * watchdog over the "connect → ready" handshake that forces a reconnect if the
 * handshake stalls. ioredis's connectTimeout only covers the TCP connect; a
 * socket that is accepted but never served (e.g. a stopped container's
 * forwarded port) would otherwise wedge the client in "connect" forever,
 * emitting no events. Also installs a no-op "error" listener so a client
 * without one cannot crash the process.
 */
export function attachConnectionSupervisor(redis: Redis, options?: RedisConnectionSupervisorOptions) {
	const logger = options?.logger;
	const connectTimeoutMs = redis.options.connectTimeout ?? 10_000;

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
				supervisor: setTimeout(onReadyHandshakeStalled, connectTimeoutMs),
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
