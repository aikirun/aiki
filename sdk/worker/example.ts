import { worker } from "@aiki/sdk/worker";
import { Aiki } from "@aiki/sdk";
import {
	type DatabaseConnection,
	type EmailService,
	eveningRoutineWorkflowV1,
	morningWorkflowV1,
	morningWorkflowV2,
} from "../workflow/example.ts";

const dbConn: DatabaseConnection = {
	query: (_sql) => {
		return Promise.resolve([]);
	},
};

const emailService: EmailService = {
	send: async (_to: string, _message: string) => {
	},
};

if (import.meta.main) {
	const client = await Aiki.client({ baseUrl: "http://localhost:9090" });

	const workerA = worker(client, {
		id: "worker-A",
		subscriber: { type: "redis_streams" },
	});

	const workerB = worker(client, {
		id: "worker-B",
		subscriber: { type: "redis_streams" },
	});

	workerA.workflowRegistry
		.add(morningWorkflowV1)
		.add(morningWorkflowV2, {
			db: dbConn,
			email: emailService,
		})
		.add(eveningRoutineWorkflowV1);

	workerB.workflowRegistry
		.add(morningWorkflowV1);

	workerA.start();
	workerB.start();

	await workerA.stop();
	await workerB.stop();
}
