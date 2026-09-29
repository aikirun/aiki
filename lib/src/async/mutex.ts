export interface Mutex {
	/**
	 * Resolves once every earlier lock has released.
	 * The resolve value is a the function that releases this lock.
	 * Releasing twice is a no-op.
	 */
	acquire(): Promise<() => void>;
	/**
	 * Runs `fn` while holding the mutex and releases it when `fn` settles.
	 */
	runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Async mutex. Holders are served in the order they called `acquire`.
 * It is not re-entrant: acquiring again while holding waits on yourself forever.
 */
export function createMutex(): Mutex {
	let lastHold = Promise.resolve();

	const acquire = async (): Promise<() => void> => {
		const previousHold = lastHold;
		let release: () => void = () => {};
		lastHold = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previousHold;
		return release;
	};

	return {
		acquire,
		async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
			const release = await acquire();
			try {
				return await fn();
			} finally {
				release();
			}
		},
	};
}
