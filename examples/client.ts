import { client } from "@aikirun/client";

export const aiki = await client({
	url: "http://localhost:9090",
	redis: {
		host: "localhost",
		port: 6379,
	},
	contextFactory: (run) => ({
		traceId: "123456789",
		workflowRunId: run.id,
	}),
});
