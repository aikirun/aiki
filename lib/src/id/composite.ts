export function getCompositeId<T extends string>(params: { name: string; referenceId: string }): T;
export function getCompositeId<T extends string>(params: { name: string; versionId: string; referenceId: string }): T;
export function getCompositeId<T extends string>({
	name,
	versionId,
	referenceId,
}: {
	name: string;
	versionId?: string;
	referenceId: string;
}): T {
	if (name.length === 0) {
		throw new Error("name cannot be empty");
	}
	if (referenceId.length === 0) {
		throw new Error("reference id cannot be empty");
	}
	if (versionId === undefined) {
		return `${name}:${referenceId}` as T;
	}
	if (versionId.length === 0) {
		throw new Error("version id cannot be empty");
	}
	return `${name}:${versionId}:${referenceId}` as T;
}
