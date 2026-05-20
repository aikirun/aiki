import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Logger } from "@aikirun/lib/logger";

export interface CacheSetOptions {
	ttlSeconds?: number;
}

export interface Cache<V> {
	get(key: string): Promise<V | null>;
	set(key: string, value: V, options?: CacheSetOptions): Promise<void>;
	invalidate(keys: string | NonEmptyArray<string>): Promise<void>;
}

export interface CacheContext {
	logger: Logger;
}

export type CreateCache<V> = (context: CacheContext) => Cache<V>;
