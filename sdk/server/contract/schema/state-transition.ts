import { type } from "arktype";

import { taskStateSchema } from "./task";
import { workflowRunStateSchema } from "./workflow-run";

export const stateTransitionSchema = type({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'workflow_run'",
	attempt: "number.integer >= 1",
	state: workflowRunStateSchema,
}).or({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'task'",
	attempt: "number.integer >= 1",
	taskId: "string > 0",
	taskState: taskStateSchema,
});
