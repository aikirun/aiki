import type { TaskAddress } from "@aikirun/types/task";
import type { WorkflowRunAddress } from "@aikirun/types/workflow-run";

/**
 * Generates an address for identifying task executions within a workflow.
 * @param name - The name of the task
 * @param referenceId - reference ID
 * @returns Task address string
 */
export function getTaskAddress(name: string, referenceId: string): TaskAddress {
	return `${name}/${referenceId}` as TaskAddress;
}

/**
 * Generates an address for identifying workflow runs.
 * @param name - The workflow name
 * @param versionId - The workflow version ID
 * @param referenceId - a reference ID
 * @returns Workflow run address string
 */
export function getWorkflowRunAddress(name: string, versionId: string, referenceId: string): WorkflowRunAddress {
	return `${name}/${versionId}/${referenceId}` as WorkflowRunAddress;
}

/**
 * Generates a Redis stream name for workflow run messages.
 * @param name - The workflow name
 * @param versionId - The workflow version ID
 * @param shard - Optional shard key for distributed processing
 * @returns Redis stream name
 */
export function getWorkflowStreamName(name: string, versionId: string, shard?: string): string {
	return shard ? `workflow/${name}/${versionId}/${shard}` : `workflow/${name}/${versionId}`;
}

/**
 * Generates a Redis consumer group name for workers.
 * @param workflowName - The workflow name
 * @param workflowVersionId - The workflow version ID
 * @param shard - Optional shard key for distributed processing
 * @returns Redis consumer group name
 */
export function getWorkerConsumerGroupName(workflowName: string, workflowVersionId: string, shard?: string): string {
	return shard ? `worker/${workflowName}/${workflowVersionId}/${shard}` : `worker/${workflowName}/${workflowVersionId}`;
}
