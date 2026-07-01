export function getTaskAddress(name: string, referenceId: string): string {
	return `${name}:${referenceId}`;
}

export function getWorkflowRunAddress(name: string, versionId: string, referenceId: string): string {
	return `${name}:${versionId}:${referenceId}`;
}
