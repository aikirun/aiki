import type { WorkflowRunRow } from "@aiki/contract/workflow-run";
import type { WorkflowRunHandle } from "@aiki/sdk/workflow";

export interface WorkflowRunContext<Payload, Result>
	extends Pick<WorkflowRunRow<Payload, Result>, "id" | "name" | "versionId" | "options"> {
	handle: WorkflowRunHandle<Payload, Result>;
}
