import type { Logger } from "@aikirun/types/logger";
import type { DistributiveOmit } from "@aikirun/types/property";
import type { ReplayManifest } from "@aikirun/types/replay-manifest";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskInfo } from "@aikirun/types/task";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import type { WorkflowRunStateRequest, WorkflowRunTransitionTaskStateRequestV1 } from "@aikirun/types/workflow-run-api";

export interface WorkflowRunContext {
	id: WorkflowRunId;
	logger: Logger;
	[INTERNAL]: {
		handle: WorkflowRunHandle;
		replayManifest: ReplayManifest;
		options: {
			spinThresholdMs: number;
		};
	};
}

export interface WorkflowRunHandle {
	run: Readonly<WorkflowRun>;
	[INTERNAL]: {
		transitionState: (state: WorkflowRunStateRequest) => Promise<void>;
		transitionTaskState: (
			request: DistributiveOmit<WorkflowRunTransitionTaskStateRequestV1, "id" | "expectedWorkflowRunRevision">
		) => Promise<TaskInfo>;
		assertExecutionAllowed: () => void;
	};
}
