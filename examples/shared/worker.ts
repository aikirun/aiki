import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Client } from "@aikirun/client";
import { client } from "@aikirun/client";
import { worker } from "@aikirun/worker";
import type { WorkflowVersion } from "@aikirun/workflow";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

/**
 * Spawns two workers with the given workflows, runs the callback, then shuts down.
 * Two workers demonstrate the distributed nature of child workflows — a parent
 * running on worker-A can have its children picked up by worker-B.
 */
export async function runWithWorker(
	// biome-ignore lint/suspicious/noExplicitAny: I want any workflow
	workflows: WorkflowVersion<any, any, any, any>[],
	callback: (client: Client<null>) => Promise<void>
): Promise<void> {
	const aikiClient = client({
		url: "http://localhost:9850",
		redis: {
			host: "localhost",
			port: 6379,
		},
	});

	const workerA = worker({
		name: "worker-A",
		workflows,
		opts: { maxConcurrentWorkflowRuns: 10 },
	});

	const workerB = worker({
		name: "worker-B",
		workflows,
		opts: { maxConcurrentWorkflowRuns: 10 },
	});

	const handleA = await workerA.spawn(aikiClient);
	const handleB = await workerB.spawn(aikiClient);

	const shutdown = async () => {
		await Promise.all([handleA.stop(), handleB.stop()]);
		await aikiClient.close();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	try {
		await callback(aikiClient);
	} finally {
		await Promise.all([handleA.stop(), handleB.stop()]);
		await aikiClient.close();
	}
}
