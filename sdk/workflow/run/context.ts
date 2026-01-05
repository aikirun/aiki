import type { Duration } from "@aikirun/lib";
import type { Logger } from "@aikirun/types/client";
import type { SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowOptions, WorkflowRunId } from "@aikirun/types/workflow-run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRunContext<Input, AppContext, TEventDefinition extends EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowOptions;
	logger: Logger;
	sleep: (id: string, duration: Duration) => Promise<SleepResult>;
	events: EventWaiters<TEventDefinition>;

	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, unknown, AppContext, TEventDefinition>;
		options: {
			spinThresholdMs: number;
		};
	};
}
