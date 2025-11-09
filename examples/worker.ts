import { worker } from "@aikirun/worker";
import { client } from "@aikirun/client";
import { eveningRoutineWorkflow, morningWorkflow } from "./workflows.ts";
import { processWrapper } from "@aikirun/lib/process";

if (import.meta.main) {
	const aiki = await client({
		url: "http://localhost:9090",
		redis: {
			host: "localhost",
			port: 6379,
		},
	});

	const workerA = worker(aiki, {
		id: "worker-A",
		subscriber: { type: "redis_streams" },
	});

	const workerB = worker(aiki, {
		id: "worker-B",
		subscriber: { type: "redis_streams" },
	});

	workerA.registry
		.add(morningWorkflow)
		.add(eveningRoutineWorkflow);

	workerB.registry
		.add(eveningRoutineWorkflow);

	const shutdown = async () => {
		await workerA.stop();
		await workerB.stop();
		await aiki.close();
		processWrapper.exit(0);
	};

	processWrapper.addSignalListener("SIGINT", shutdown);
	processWrapper.addSignalListener("SIGTERM", shutdown);

	await workerA.start();
	await workerB.start();
}
