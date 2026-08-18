import type { ConfigProvider } from "@aikirun/lib/config";
import type { Duration } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { BoundHasher } from "@aikirun/types/infra/hasher";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { ReplayManifest, SleepResult, WorkflowRunId, WorkflowRunOptions } from "@aikirun/types/workflow/run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowExecutionConfig } from "./execute";
import type { WorkflowRunHandle } from "./handle";

export interface WorkflowRun<Input, Context, TEvents extends EventsDefinition = EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowRunOptions;
	logger: Logger;
	sleep: (name: string, duration: Duration) => Promise<SleepResult>;
	events: EventWaiters<TEvents>;
	context: Context;
	[INTERNAL]: {
		handle: WorkflowRunHandle<Input, unknown, Context, TEvents>;
		replayManifest: ReplayManifest;
		configProvider: ConfigProvider<WorkflowExecutionConfig>;
		hasher: BoundHasher;
	};
}
