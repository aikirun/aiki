export function getWorkflowQueueName(name: string, versionId: string, shard?: string): string {
	return shard ? `aiki:workflow:${name}:${versionId}:${shard}` : `aiki:workflow:${name}:${versionId}`;
}
