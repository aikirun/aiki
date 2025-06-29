export async function delay(ms: number, options?: { signal?: AbortSignal }): Promise<void> {
    if (typeof Deno !== "undefined") {
      const { delay: denoDelay } = await import("@std/async/delay");
      return denoDelay(ms, options);
    } else {
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
}