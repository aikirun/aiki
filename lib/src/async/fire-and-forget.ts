export function fireAndForget(promise: Promise<void>, onError: (err: Error) => void): void {
	promise.catch((err) => {
		onError(err instanceof Error ? err : new Error(String(err)));
	});
}
