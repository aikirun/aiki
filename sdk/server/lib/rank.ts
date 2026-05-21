export type Ranked<T> = T & { rank: number };

export const PRIORITY_LEVELS = 10;
export const DEFAULT_PRIORITY = PRIORITY_LEVELS - 1;

export function computeRank(dueAtMs: number, priority: number = DEFAULT_PRIORITY): number {
	return dueAtMs * PRIORITY_LEVELS + priority;
}

export function rankDueAtMs(rank: number): number {
	return Math.floor(rank / PRIORITY_LEVELS);
}
