import type { Logger } from "@aikirun/types/client";
import type { SleepParams, SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowOptions, WorkflowRunId } from "@aikirun/types/workflow-run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRunContext<Input, AppContext, TEventDefinition extends EventsDefinition> {
	id: WorkflowRunId;
	workflowId: WorkflowId;
	workflowVersionId: WorkflowVersionId;
	options: WorkflowOptions;
	logger: Logger;
	sleep: (params: SleepParams) => Promise<SleepResult>;
	events: EventWaiters<TEventDefinition>;

	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, unknown, AppContext, TEventDefinition>;
		options: {
			spinThresholdMs: number;
		};
	};
}
