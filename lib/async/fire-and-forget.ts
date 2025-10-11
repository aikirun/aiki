export function fireAndForget(promise: Promise<void>, onError: (error: Error) => void): void {
	promise.catch((error) => {
		onError(error instanceof Error ? error : new Error(String(error)));
	});
}
