import type { WorkflowOptions, WorkflowRunId } from "@aiki/types/workflow-run";
import type { Logger } from "@aiki/types/client";
import type { Duration } from "@aiki/lib/duration";
import type { WorkflowRunHandle } from "./run-handle.ts";
import type { WorkflowName, WorkflowVersionId } from "@aiki/types/workflow";

export interface WorkflowRunContext<Input, Output> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	options: WorkflowOptions;
	handle: WorkflowRunHandle<Input, Output>;
	logger: Logger;
	sleep: (duration: Duration) => Promise<void>;
}
