import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowSource } from "@aikirun/types/workflow/workflow";

export function getWorkflowQueueName(params: {
	source: WorkflowSource;
	name: string;
	versionId: string;
	pool?: string;
}): string {
	const { source, name, versionId, pool } = params;
	const parts = ["aiki", "workflow", source, name, versionId];
	if (pool) {
		parts.push(pool);
	}
	return parts.map((part) => part.replaceAll("%", "%25").replaceAll(":", "%3A")).join(":");
}

export function getWorkflowQueueNames(workflows: WorkflowMeta[], pools?: string[]): string[] {
	if (!isNonEmptyArray(pools)) {
		return workflows.map((workflow) =>
			getWorkflowQueueName({ source: workflow.source, name: workflow.name, versionId: workflow.versionId })
		);
	}

	return workflows.flatMap((workflow) =>
		pools.map((pool) =>
			getWorkflowQueueName({ source: workflow.source, name: workflow.name, versionId: workflow.versionId, pool })
		)
	);
}
