import type { WorkflowRun } from "@aiki/types/workflow-run";
import type { Logger } from "@aiki/types/client";
import type { WorkflowRunHandle } from "./run-handle.ts";

export interface WorkflowRunContext<Input, Output>
	extends Pick<WorkflowRun<Input, Output>, "id" | "name" | "versionId" | "options"> {
	handle: WorkflowRunHandle<Input, Output>;
	logger: Logger;
}
