import { type } from "arktype";

import { taskStateSchema } from "./task";
import { workflowRunStateSchema } from "./workflow-run";

export const stateTransitionSchema = type({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'workflow_run'",
	state: workflowRunStateSchema,
}).or({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'task'",
	taskId: "string > 0",
	taskState: taskStateSchema,
});
