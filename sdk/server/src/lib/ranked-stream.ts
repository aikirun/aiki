export interface RankedStreamCursor {
	rank: number;
	id: string;
	maxSeenId: string;
}

/**
 * Updates the cursor as we walk a stream ordered by (rank, id).
 *
 * The cursor holds two things:
 * - `(rank, id)` — the frontier: where the last row the walk settled on sits.
 * - `maxSeenId` — the largest id seen in any row so far. The filter's third clause
 *   uses it to pick up rows that sort before the frontier but were inserted after
 *   the walk passed them.
 *
 * Rows arrive in (rank, id) order. When a row sits at or after the frontier
 * (rank >= cursor.rank) it is the next step of the walk, so the frontier moves onto
 * it. A row that sorts before the frontier can only be one of those late inserts the
 * third clause pulled in, so the frontier stays where it is and only maxSeenId grows.
 * Moving the frontier backwards would make the next query re-read a rank we finished.
 */
export function advanceRankedStreamCursor(
	cursor: RankedStreamCursor | undefined,
	item: { rank: number; id: string }
): RankedStreamCursor {
	const { rank, id } = item;

	if (!cursor) {
		return { rank, id, maxSeenId: id };
	}

	const { maxSeenId: cursorMaxSeenId } = cursor;
	const maxSeenId = id > cursorMaxSeenId ? id : cursorMaxSeenId;

	if (rank >= cursor.rank) {
		return { rank, id, maxSeenId };
	} else {
		return { rank: cursor.rank, id: cursor.id, maxSeenId };
	}
}
