export async function delay(ms: number, options?: { abortSignal?: AbortSignal }): Promise<void> {
    if (typeof Deno !== "undefined") {
      const { delay: denoDelay } = await import("@std/async/delay");
      return denoDelay(ms, {signal: options?.abortSignal});
    } else {
		const abortSignal = options?.abortSignal;
		if (abortSignal?.aborted) return Promise.reject(abortSignal.reason);

		return new Promise((resolve, reject) => {
			const abort = () => {
				clearTimeout(timeout);
				reject(abortSignal?.reason);
			};

			const timeout = setTimeout(() => {
				abortSignal?.removeEventListener("abort", abort);
				resolve();
			}, ms);

			abortSignal?.addEventListener("abort", abort, { once: true });
		});
    }
}