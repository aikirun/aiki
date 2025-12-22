import type { Logger } from "@aikirun/types/client";
import type { SleepParams, SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowOptions, WorkflowRunId } from "@aikirun/types/workflow-run";

import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRunContext<Input, Output> {
	id: WorkflowRunId;
	workflowId: WorkflowId;
	workflowVersionId: WorkflowVersionId;
	options: WorkflowOptions;
	logger: Logger;
	sleep: (params: SleepParams) => Promise<SleepResult>;

	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, Output>;
		options: {
			spinThresholdMs: number;
		};
	};
}
