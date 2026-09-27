import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type Client, client } from "@aikirun/client";
import { loadDatabaseConfig } from "@aikirun/lib/db";
import { inMemoryQueue, inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { redisSubscriber } from "@aikirun/redis";
import { database, type ServerRuntimeHandle, server } from "@aikirun/server";
import type { CreateSubscriber } from "@aikirun/types/infra/queue";
import { worker } from "@aikirun/worker";
import type { AnyWorkflowVersion } from "@aikirun/workflow";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

interface Setup {
	client: Client;
	subscriber?: CreateSubscriber;
	serverRuntimeHandle?: ServerRuntimeHandle;
}

/**
 * Starts two workers that listen for the given workflows, runs the callback,
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
		config: { maxConcurrentWorkflowRuns: 10 },
	});

	const workerB = worker({
		workflows,
		...(subscriber && { subscriber }),
		config: { maxConcurrentWorkflowRuns: 10 },
	});

	const handleA = workerA.start(aikiClient);
	const handleB = workerB.start(aikiClient);

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
			db: database(loadDatabaseConfig()),
			timerPriorityQueue,
			runtime: { publisher: queue.publisher },
		});
		const runtimeHandle = aiki.runtime.start();

		return {
			client: client({ handler: aiki.handler }),
			subscriber: queue.subscriber,
			serverRuntimeHandle: runtimeHandle,
		};
	}

	const url = process.env.AIKI_SERVER_URL ?? "http://localhost:9850";
	const apiKey = process.env.AIKI_API_KEY;

	const redisUrl = process.env.REDIS_URL;
	const subscriber = redisUrl ? redisSubscriber({ url: redisUrl }) : undefined;

	return {
		client: client({ url, ...(apiKey && { apiKey }) }),
		...(subscriber && { subscriber }),
	};
}
