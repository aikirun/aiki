export interface KeysetStreamCursor {
	order: number;
	id: string;
	maxSeenId: string;
}

/**
 * Builds a function that updates the cursor as we walk a stream ordered by (order, id),
 * where `order` is any sortable numeric key — a priority rank, a due timestamp, and so on.
 *
 * The cursor holds two things:
 * - `(order, id)` — the frontier: where the last row the walk settled on sits.
 * - `maxSeenId` — the largest id seen in any row so far. The filter's third clause
 *   uses it to pick up rows that sort before the frontier but were inserted after
 *   the walk passed them.
 *
 * Rows arrive in (order, id) order. When a row sits at or after the frontier
 * (order >= cursor.order) it is the next step of the walk, so the frontier moves onto
 * it. A row that sorts before the frontier can only be one of those late inserts the
 * third clause pulled in, so the frontier stays where it is and only maxSeenId grows.
 * Moving the frontier backwards would make the next query re-read an order we finished.
 *
 * getOrder/getId read those fields from whatever shape the caller's items have.
 */
export function createKeysetStreamCursorAdvancer<Item>(options: {
	getOrder: (item: Item) => number;
	getId: (item: Item) => string;
}): (cursor: KeysetStreamCursor | undefined, item: Item) => KeysetStreamCursor {
	const { getOrder, getId } = options;

	return (cursor, item) => {
		const order = getOrder(item);
		const id = getId(item);

		if (!cursor) {
			return { order, id, maxSeenId: id };
		}

		const { maxSeenId: cursorMaxSeenId } = cursor;
		const maxSeenId = id > cursorMaxSeenId ? id : cursorMaxSeenId;

		if (order >= cursor.order) {
			return { order, id, maxSeenId };
		} else {
			return { order: cursor.order, id: cursor.id, maxSeenId };
		}
	};
}
