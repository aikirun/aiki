import { asNonEmptyArray, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowSource } from "@aikirun/types/workflow/workflow";

/**
 * `aiki:{<namespace>}:workflow:<source>:<name>:<version>[:<pool>]`.
 *
 * The braces make the namespace a Redis Cluster hash tag so that every queue in a
 * namespace resides on the same node; multi key commands do not allow cross node keys.
 * The format also gives a per-namespace ACL pattern (`~aiki:{<namespace>}:*`) one prefix to match.
 */
export function getWorkflowQueueName(params: {
	namespaceId: string;
	source: WorkflowSource;
	name: string;
	versionId: string;
	pool?: string;
}): string {
	const { namespaceId, source, name, versionId, pool } = params;
	const parts = ["workflow", source, name, versionId];
	if (pool) {
		parts.push(pool);
	}
	return ["aiki", `{${escapeQueueNamePart(namespaceId)}}`, ...parts.map(escapeQueueNamePart)].join(":");
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

function escapeQueueNamePart(part: string): string {
	return part.replaceAll("%", "%25").replaceAll(":", "%3A").replaceAll("{", "%7B").replaceAll("}", "%7D");
}
