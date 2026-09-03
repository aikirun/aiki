import type { ConfigProvider } from "@aikirun/lib/config";
import type { Duration } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { Codec } from "@aikirun/types/infra/codec";
import type { BoundHasher } from "@aikirun/types/infra/hasher";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { ReplayManifest, SleepResult, WorkflowRunId, WorkflowRunOptions } from "@aikirun/types/workflow/run";

import type { EventsDefinition, EventWaiters } from "./event";
import type { WorkflowExecutionConfig } from "./execute";
import type { WorkflowRunHandle } from "./handle";
import type { CreateTaskExecutionTracker } from "./task-execution-tracker";

export interface WorkflowRun<Context, TEvents extends EventsDefinition = EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowRunOptions;
	logger: Logger;
	sleep: (name: string, duration: Duration) => Promise<SleepResult>;
	events: EventWaiters<TEvents>;
	context: Context;
	[INTERNAL]: {
		handle: WorkflowRunHandle<unknown, Context, TEvents>;
		replayManifest: ReplayManifest;
		createTaskExecutionTracker: CreateTaskExecutionTracker;
		configProvider: ConfigProvider<WorkflowExecutionConfig>;
		hasher: BoundHasher;
		codec: Codec;
		clientCodecApplied: boolean;
	};
}
