import type { TaskPath } from "@aikirun/types/task";
import type { WorkflowRunPath } from "@aikirun/types/workflow-run";

/**
 * Generates a path for identifying task executions within a workflow.
 * @param name - The name of the task
 * @param referenceId - reference ID
 * @returns Task path string
 */
export function getTaskPath(name: string, referenceId: string): TaskPath {
	return `${name}/${referenceId}` as TaskPath;
}

/**
 * Generates a path for identifying workflow runs.
 * @param name - The workflow name
 * @param versionId - The workflow version ID
 * @param referenceId - a reference ID
 * @returns Workflow run path string
 */
export function getWorkflowRunPath(name: string, versionId: string, referenceId: string): WorkflowRunPath {
	return `${name}/${versionId}/${referenceId}` as WorkflowRunPath;
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
