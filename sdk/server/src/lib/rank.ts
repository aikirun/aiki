export type Ranked<T> = T & { rank: number };

export const PRIORITY_LEVELS = 10;
export const DEFAULT_PRIORITY = 5;

/**
 * Encodes a due time and a priority into one sortable number: `dueAt * PRIORITY_LEVELS + priority`.
 * Lower ranks dispatch first. Time dominates: an item due 1ms earlier always outranks a later one,
 * whatever their priorities. Priority (0 highest, `PRIORITY_LEVELS - 1` lowest) only breaks ties
 * between items due in the same millisecond.
 */
export function computeRank(params: { dueAt: number; priority?: number }): number {
	return params.dueAt * PRIORITY_LEVELS + (params.priority ?? DEFAULT_PRIORITY);
}

export function extractRankDueAtMs(rank: number): number {
	return Math.floor(rank / PRIORITY_LEVELS);
}

// The priority digit is the low-order digit of the rank — `rank mod PRIORITY_LEVELS`.
export function extractRankPriority(rank: number): number {
	return rank - extractRankDueAtMs(rank) * PRIORITY_LEVELS;
}
