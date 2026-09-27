import { asNonEmptyArray, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowSource } from "@aikirun/types/workflow";

export function getWorkflowQueueName(params: {
	namespaceId: string;
	source: WorkflowSource;
	name: string;
	versionId: string;
	pool?: string;
}): string {
	const { namespaceId, source, name, versionId, pool } = params;
	const parts = [namespaceId, source, name, versionId];
	if (pool) {
		parts.push(pool);
	}
	return parts.map((part) => part.replaceAll("%", "%25").replaceAll(":", "%3A")).join(":");
}

export function getWorkflowQueueNames(
	namespaceId: string,
	workflows: NonEmptyArray<WorkflowMeta>,
	pools?: string[]
): NonEmptyArray<string> {
	if (!isNonEmptyArray(pools)) {
		return asNonEmptyArray(
			workflows.map((workflow) =>
				getWorkflowQueueName({
					namespaceId,
					source: workflow.source,
					name: workflow.name,
					versionId: workflow.versionId,
				})
			)
		);
	}
	return asNonEmptyArray(
		workflows.flatMap((workflow) =>
			pools.map((pool) =>
				getWorkflowQueueName({
					namespaceId,
					source: workflow.source,
					name: workflow.name,
					versionId: workflow.versionId,
					pool,
				})
			)
		)
	);
}
