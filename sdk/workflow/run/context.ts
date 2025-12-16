import type { WorkflowOptions, WorkflowRunId } from "@aikirun/types/workflow-run";
import type { Logger } from "@aikirun/types/client";
import type { SleepParams } from "@aikirun/types/sleep";
import type { WorkflowRunHandle } from "./run-handle";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";

export interface WorkflowRunContext<Input, Output> {
	id: WorkflowRunId;
	workflowId: WorkflowId;
	workflowVersionId: WorkflowVersionId;
	options: WorkflowOptions;
	handle: WorkflowRunHandle<Input, Output>;
	logger: Logger;
	sleep: (params: SleepParams) => Promise<void>;
}
