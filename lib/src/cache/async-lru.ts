export type AsyncLruCacheParams = {
	maxEntries: number;
	ttlMs: number | null;
};

type PendingEntry<TValue> = {
	type: "pending";
	promise: Promise<TValue>;
};

type ReadyEntry<TValue> = {
	type: "ready";
	value: TValue;
	cachedAtMs: number;
};

type CacheEntry<TValue> = PendingEntry<TValue> | ReadyEntry<TValue>;

export type AsyncLruCache<TValue, TKey = string> = {
	getOrCreate(key: TKey, create: () => Promise<TValue>): Promise<TValue>;
};

function isExpired<TValue>(entry: ReadyEntry<TValue>, ttlMs: number | null, nowMs: number): boolean {
	if (ttlMs === null) {
		return false;
	}

	return nowMs - entry.cachedAtMs >= ttlMs;
}

/**
 * Bounded LRU cache with in-flight promise deduplication.
 * Rejected creates are not retained. Ready entries older than `ttlMs` are treated as misses.
 * The entry count never exceeds `maxEntries`; a new lookup evicts the least-recent entry
 * (pending or ready). Callers of an evicted pending lookup still receive its value.
 */
export function createAsyncLruCache<TValue, TKey = string>(options: AsyncLruCacheParams): AsyncLruCache<TValue, TKey> {
	const { maxEntries, ttlMs } = options;
	const entries = new Map<TKey, CacheEntry<TValue>>();

	const ensureSizeLimit = (): void => {
		while (entries.size >= maxEntries) {
			// Map keeps keys in insertion order, so the oldest key is the first one.
			const oldestKey = entries.keys().next().value;

			if (oldestKey === undefined) {
				return;
			}

			entries.delete(oldestKey);
		}
	};

	return {
		getOrCreate(key, create) {
			const nowMs = Date.now();
			const existing = entries.get(key);

			if (existing?.type === "pending") {
				return existing.promise;
			}

			if (existing?.type === "ready") {
				if (!isExpired(existing, ttlMs, nowMs)) {
					entries.delete(key);
					entries.set(key, existing);

					return Promise.resolve(existing.value);
				}

				entries.delete(key);
			}

			const promise = create().then(
				(value) => {
					const current = entries.get(key);
					if (current?.type === "pending" && current.promise === promise) {
						entries.delete(key);
						entries.set(key, { type: "ready", value, cachedAtMs: Date.now() });
					}

					return value;
				},
				(err: unknown) => {
					const current = entries.get(key);
					if (current?.type === "pending" && current.promise === promise) {
						entries.delete(key);
					}

					throw err;
				}
			);

			ensureSizeLimit();
			entries.set(key, { type: "pending", promise });

			return promise;
		},
	};
}
