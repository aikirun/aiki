import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowSource } from "@aikirun/types/workflow";

export function getWorkflowQueueName(params: {
	source: WorkflowSource;
	name: string;
	versionId: string;
	pool?: string;
}): string {
	const { source, name, versionId, pool } = params;
	return pool ? `${source}:${name}:${versionId}:${pool}` : `${source}:${name}:${versionId}`;
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
