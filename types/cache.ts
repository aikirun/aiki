import type { NonEmptyArray } from "@aikirun/lib/array";

export interface CacheSetOptions {
	ttlSeconds?: number;
}

export interface Cache<V> {
	get(key: string): Promise<V | null>;
	set(key: string, value: V, options?: CacheSetOptions): Promise<void>;
	invalidate(keys: string | NonEmptyArray<string>): Promise<void>;
}
