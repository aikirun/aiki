import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta } from "@aikirun/types/workflow";

export function getWorkflowQueueName(name: string, versionId: string, shard?: string): string {
	return shard ? `${name}:${versionId}:${shard}` : `${name}:${versionId}`;
}

export function getWorkflowQueueNames(workflows: WorkflowMeta[], shards?: string[]): string[] {
	if (!isNonEmptyArray(shards)) {
		return workflows.map((workflow) => getWorkflowQueueName(workflow.name, workflow.versionId));
	}
	return workflows.flatMap((workflow) =>
		shards.map((shard) => getWorkflowQueueName(workflow.name, workflow.versionId, shard))
	);
}
