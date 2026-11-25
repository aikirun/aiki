import type { ConfigProvider } from "@aikirun/lib/config";
import type { DurationObject } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { BoundHasher } from "@aikirun/types/infra/hasher";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { ReplayManifest, SleepResult, WorkflowRunId, WorkflowRunOptions } from "@aikirun/types/workflow/run";

import type { EventsDefinition } from "./event/definition";
import type { EventWaiters } from "./event/waiter";
import type { WorkflowExecutionConfig } from "./execution/config";
import type { CreateTaskExecutionTracker } from "./execution/task-execution-tracker";
import type { WorkflowRunHandle } from "./handle/workflow-run";

export interface WorkflowRun<Context, TEvents extends EventsDefinition = EventsDefinition> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowRunOptions;
	logger: Logger;
	sleep: (name: string, duration: DurationObject) => Promise<SleepResult>;
	events: EventWaiters<TEvents>;
	context: Context;
	[INTERNAL]: {
		handle: WorkflowRunHandle<unknown, Context, TEvents>;
		replayManifest: ReplayManifest;
		createTaskExecutionTracker: CreateTaskExecutionTracker;
		configProvider: ConfigProvider<WorkflowExecutionConfig>;
		hasher: BoundHasher;
		createContext: () => Context | Promise<Context>;
	};
}
