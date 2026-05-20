import type { Cache, CacheContext, CacheSetOptions, CreateCache } from "@aikirun/types/infra/cache";
import type { Redis } from "ioredis";

export function redisCache(redis: Redis): CreateCache {
	return <V>({ keyPrefix }: CacheContext): Cache<V> => {
		const getCacheKey = (key: string) => (keyPrefix !== undefined ? `${keyPrefix}${key}` : key);

		return {
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
		};
	};
}
