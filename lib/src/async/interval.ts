import { fireAndForget } from "./fire-and-forget";

export function runOnInterval(
	fn: () => Promise<void>,
	options: {
		intervalMs: number | (() => number);
		onError: (error: Error) => void;
		signal?: AbortSignal;
	}
): { stop: () => void } {
	const { intervalMs, onError, signal } = options;

	if (signal?.aborted) {
		return { stop: () => {} };
	}

	let timeout: ReturnType<typeof setTimeout> | undefined;
	const tick = (): void => {
		timeout = setTimeout(
			() => {
				fireAndForget(fn(), onError);
				if (!signal?.aborted) {
					tick();
				}
			},
			typeof intervalMs === "number" ? intervalMs : intervalMs()
		);
	};

	const stop = (): void => {
		if (timeout) {
			clearTimeout(timeout);
		}
		signal?.removeEventListener("abort", stop);
	};
	signal?.addEventListener("abort", stop, { once: true });

	tick();

	return { stop };
}
