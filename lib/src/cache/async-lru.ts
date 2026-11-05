export type AsyncLruCacheOptions = {
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
 */
export function createAsyncLruCache<TValue, TKey = string>(options: AsyncLruCacheOptions): AsyncLruCache<TValue, TKey> {
	const { maxEntries, ttlMs } = options;
	const entries = new Map<TKey, CacheEntry<TValue>>();

	const evictOldestReadyUntilSpace = (): void => {
		while (entries.size >= maxEntries) {
			let oldestReadyKey: TKey | undefined;
			for (const [key, entry] of entries) {
				if (entry.type === "ready") {
					oldestReadyKey = key;
					break;
				}
			}
			if (oldestReadyKey === undefined) {
				return;
			}
			entries.delete(oldestReadyKey);
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
						evictOldestReadyUntilSpace();
						if (entries.size < maxEntries) {
							entries.set(key, { type: "ready", value, cachedAtMs: Date.now() });
						}
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

			entries.set(key, { type: "pending", promise });
			return promise;
		},
	};
}
