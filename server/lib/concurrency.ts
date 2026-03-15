import type { Context } from "server/middleware/context";
import { forkContext } from "server/middleware/context";

export interface RunConcurrentlyOptions {
	concurrency?: number;
	failFast?: boolean;
}

export async function runConcurrently<Item, TContext extends Context>(
	context: TContext,
	items: Iterable<Item>,
	fn: (item: Item, spanCtx: TContext) => Promise<void>,
	options?: RunConcurrentlyOptions
): Promise<void> {
	const concurrency = options?.concurrency ?? 5;
	const failFast = options?.failFast ?? false;

	const iterator = items[Symbol.iterator]();
	let firstError: unknown = null;
	let stopped = false;

	async function worker(): Promise<void> {
		while (true) {
			if (stopped || context.signal?.aborted) {
				return;
			}

			const next = iterator.next();
			if (next.done) {
				return;
			}

			const spanCtx = forkContext(context);
			try {
				await fn(next.value, spanCtx);
			} catch (error) {
				if (!firstError) {
					firstError = error;
				}
				if (failFast) {
					stopped = true;
					return;
				}
			}
		}
	}

	const workerCount = Math.min(concurrency, Array.isArray(items) ? items.length : concurrency);
	const workers: Promise<void>[] = [];
	for (let i = 0; i < workerCount; i++) {
		workers.push(worker());
	}

	await Promise.all(workers);

	if (firstError) {
		throw firstError;
	}
}
