import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { client } from "@aikirun/client";
import type { Client } from "@aikirun/types/client";
import { worker } from "@aikirun/worker";
import type { AnyWorkflowVersion } from "@aikirun/workflow";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

/**
 * Spawns two workers with the given workflows, runs the callback, then shuts down.
 * Two workers demonstrate the distributed nature of child workflows — a parent
 * running on worker-A can have its children picked up by worker-B.
 */
export async function runWithWorker(
	workflows: AnyWorkflowVersion[],
	callback: (client: Client) => Promise<void>
): Promise<void> {
	const apiKey = process.env.AIKI_API_KEY;
	if (!apiKey) {
		throw new Error("AIKI_API_KEY environment variable is required");
	}

	const aikiClient = client({
		url: process.env.AIKI_SERVER_URL ?? "http://localhost:9850",
		apiKey,
	});

	const workerA = worker({
		workflows,
		opts: { maxConcurrentWorkflowRuns: 10 },
	});

	const workerB = worker({
		workflows,
		opts: { maxConcurrentWorkflowRuns: 10 },
	});

	const handleA = await workerA.spawn(aikiClient);
	const handleB = await workerB.spawn(aikiClient);

	const shutdown = async () => {
		await Promise.all([handleA.stop(), handleB.stop()]);

		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	try {
		await callback(aikiClient);
	} finally {
		await Promise.all([handleA.stop(), handleB.stop()]);
	}
}
