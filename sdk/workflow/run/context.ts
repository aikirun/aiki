import type { WorkflowRun } from "@aiki/contract/workflow-run";
import type { Logger } from "@aiki/client";
import type { WorkflowRunHandle } from "./run-handle.ts";

export interface WorkflowRunContext<Input, Output>
	extends Pick<WorkflowRun<Input, Output>, "id" | "name" | "versionId" | "options"> {
	handle: WorkflowRunHandle<Input, Output>;
	logger: Logger;
}
