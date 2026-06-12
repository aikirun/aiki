import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type Client, client } from "@aikirun/client";
import { omitUndefined } from "@aikirun/lib/object";
import { inMemoryQueue, inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { redisSubscriber } from "@aikirun/redis";
import { database, type ServerRuntimeHandle, server } from "@aikirun/server";
import { databaseConfigSchema } from "@aikirun/server/config";
import { DATABASE_PROVIDERS, isDatabaseProvider } from "@aikirun/types/infra/db";
import type { CreateSubscriber } from "@aikirun/types/infra/queue";
import { worker } from "@aikirun/worker";
import type { AnyWorkflowVersion } from "@aikirun/workflow";
import { type } from "arktype";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

interface Setup {
	client: Client;
	subscriber?: CreateSubscriber;
	serverRuntimeHandle?: ServerRuntimeHandle;
}

/**
 * Spawns two workers that listen for the given workflows, runs the callback,
 * then shuts down.
 *
 * Two workers demonstrate the distributed nature of workflows.
 * For instance, a parent workflow running on worker-A can have
 * its children picked up by worker-B.
 *
 * Switches between embedded mode (server and workers all in this process)
 * and remote mode (talks to a separately-deployed server over HTTP) via
 * AIKI_EXAMPLE_MODE.
 */
export async function runWithWorker(
	workflows: AnyWorkflowVersion[],
	callback: (client: Client) => Promise<void>
): Promise<void> {
	const { client: aikiClient, subscriber, serverRuntimeHandle } = await setup();

	const workerA = worker({
		workflows,
		...(subscriber && { subscriber }),
		options: { maxConcurrentWorkflowRuns: 10 },
	});

	const workerB = worker({
		workflows,
		...(subscriber && { subscriber }),
		options: { maxConcurrentWorkflowRuns: 10 },
	});

	const handleA = await workerA.spawn(aikiClient);
	const handleB = await workerB.spawn(aikiClient);

	const shutdown = async (exitCode: number) => {
		await Promise.all([handleA.stop(), handleB.stop()]);
		await serverRuntimeHandle?.stop();
		process.exit(exitCode);
	};

	process.on("SIGINT", () => shutdown(0));
	process.on("SIGTERM", () => shutdown(0));

	try {
		await callback(aikiClient);
	} catch (err) {
		aikiClient.logger.error("Scenario failed", { err });
		await shutdown(1);
	}

	await shutdown(0);
}

async function setup(): Promise<Setup> {
	const mode = process.env.AIKI_EXAMPLE_MODE;
	if (mode !== "embedded" && mode !== "remote") {
		throw new Error(`AIKI_EXAMPLE_MODE must be "embedded" or "remote" (got ${mode ?? "undefined"})`);
	}

	if (mode === "embedded") {
		const queue = inMemoryQueue();
		const timerPriorityQueue = inMemoryTimerPriorityQueue();

		const aiki = server({
			db: database(readDatabaseEnv()),
			runtime: { publisher: queue.publisher, timerPriorityQueue },
		});
		const runtimeHandle = await aiki.runtime.start();

		return {
			client: client({ handler: aiki.handler }),
			subscriber: queue.subscriber,
			serverRuntimeHandle: runtimeHandle,
		};
	}

	const url = process.env.AIKI_SERVER_URL ?? "http://localhost:9850";
	const apiKey = process.env.AIKI_API_KEY;

	const redisHost = process.env.REDIS_HOST;
	const subscriber = redisHost
		? redisSubscriber({
				host: redisHost,
				port: Number(process.env.REDIS_PORT ?? 6379),
				...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
			})
		: undefined;

	return {
		client: client({ url, ...(apiKey && { apiKey }) }),
		...(subscriber && { subscriber }),
	};
}

function readDatabaseEnv() {
	const provider = process.env.DATABASE_PROVIDER ?? "pg";
	if (!isDatabaseProvider(provider)) {
		throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Must be one of: ${DATABASE_PROVIDERS.join(", ")}`);
	}

	const raw =
		provider === "sqlite"
			? { provider, path: process.env.DATABASE_PATH }
			: {
					provider,
					url: process.env.DATABASE_URL,
					maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
					ssl: process.env.DATABASE_SSL,
				};

	const result = databaseConfigSchema(omitUndefined(raw));
	if (result instanceof type.errors) {
		throw new Error(`Invalid database config: ${result.summary}`);
	}
	return result;
}
