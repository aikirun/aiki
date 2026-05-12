import type { TaskAddress } from "@aikirun/types/task";
import type { WorkflowRunAddress } from "@aikirun/types/workflow-run";

export function getTaskAddress(name: string, inputHash: string): TaskAddress {
	return `${name}:${inputHash}` as TaskAddress;
}

export function getWorkflowRunAddress(name: string, versionId: string, referenceId: string): WorkflowRunAddress {
	return `${name}:${versionId}:${referenceId}` as WorkflowRunAddress;
}
