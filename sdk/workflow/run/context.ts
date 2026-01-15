import type { Duration } from "@aikirun/lib";
import type { Logger } from "@aikirun/types/client";
import type { SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowStartOptions } from "@aikirun/types/workflow-run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRunContext<Input, AppContext, TEvents extends EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowStartOptions;
	logger: Logger;
	sleep: (name: string, duration: Duration) => Promise<SleepResult>;
	events: EventWaiters<TEvents>;

	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, unknown, AppContext, TEvents>;
		options: {
			spinThresholdMs: number;
		};
	};
}
