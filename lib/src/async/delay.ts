/** The longest delay a timer can wait in memory. A longer one fires after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function delay(ms: number, options?: { signal?: AbortSignal }): Promise<void> {
	const signal = options?.signal;
	if (signal?.aborted) {
		return Promise.reject(signal.reason);
	}

	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timeout);
			reject(signal?.reason);
		};

		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", abort, { once: true });
	});
}
