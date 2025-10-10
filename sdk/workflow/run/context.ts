import type { WorkflowRunRow } from "@aiki/contract/workflow-run";
import type { WorkflowRunHandle } from "@aiki/sdk/workflow";

export interface WorkflowRunContext<Input, Output>
	extends Pick<WorkflowRunRow<Input, Output>, "id" | "name" | "versionId" | "options"> {
	handle: WorkflowRunHandle<Input, Output>;
}
