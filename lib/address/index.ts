export function getTaskAddress(name: string, inputHash: string): string {
	return `${name}:${inputHash}`;
}

export function getWorkflowRunAddress(name: string, versionId: string, referenceId: string): string {
	return `${name}:${versionId}:${referenceId}`;
}
