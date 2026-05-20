import type { CacheContext, CacheSetOptions, CreateCache } from "@aikirun/types/infra/cache";
import type { Redis } from "ioredis";

export interface RedisCacheOptions {
	keyPrefix?: string;
}

export function redisCache<V>(redis: Redis, options?: RedisCacheOptions): CreateCache<V> {
	const keyPrefix = options?.keyPrefix ?? "";
	const getCacheKey = (key: string) => `${keyPrefix}${key}`;

	return (_context: CacheContext) => ({
		async get(key: string): Promise<V | null> {
			const cached = await redis.get(getCacheKey(key));
			if (!cached) {
				return null;
			}
			return JSON.parse(cached) as V;
		},

		async set(key: string, value: V, setOptions?: CacheSetOptions): Promise<void> {
			const cacheKey = getCacheKey(key);
			const serialized = JSON.stringify(value);
			if (setOptions?.ttlSeconds !== undefined) {
				await redis.setex(cacheKey, setOptions.ttlSeconds, serialized);
			} else {
				await redis.set(cacheKey, serialized);
			}
		},

		async invalidate(keys): Promise<void> {
			if (Array.isArray(keys)) {
				await redis.del(...keys.map(getCacheKey));
			} else {
				await redis.del(getCacheKey(keys));
			}
		},
	});
}
