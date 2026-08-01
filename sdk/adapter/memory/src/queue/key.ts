import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta } from "@aikirun/types/workflow";

export function getWorkflowQueueName(name: string, versionId: string, pool?: string): string {
	return pool ? `${name}:${versionId}:${pool}` : `${name}:${versionId}`;
}

export function getWorkflowQueueNames(workflows: WorkflowMeta[], pools?: string[]): string[] {
	if (!isNonEmptyArray(pools)) {
		return workflows.map((workflow) => getWorkflowQueueName(workflow.name, workflow.versionId));
	}
	return workflows.flatMap((workflow) =>
		pools.map((pool) => getWorkflowQueueName(workflow.name, workflow.versionId, pool))
	);
}
