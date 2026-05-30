import type { Duration } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { ReplayManifest, SleepResult, WorkflowRunId, WorkflowStartOptions } from "@aikirun/types/workflow/run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRun<Input, AppContext, TEvents extends EventsDefinition = EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowStartOptions;
	logger: Logger;
	sleep: (name: string, duration: Duration) => Promise<SleepResult>;
	events: EventWaiters<TEvents>;
	context: AppContext;
	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, unknown, AppContext, TEvents>;
		replayManifest: ReplayManifest;
		options: {
			spinThresholdMs: number;
		};
	};
}
