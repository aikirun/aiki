export interface RankStreamCursor {
	rank: number;
	id: string;
	maxId: string;
}

export function createRankStreamCursorAdvancer<Item>(options: {
	getRank: (item: Item) => number;
	getId: (item: Item) => string;
}): (cursor: RankStreamCursor | undefined, item: Item) => RankStreamCursor {
	const { getRank, getId } = options;

	return (cursor, item) => {
		const rank = getRank(item);
		const id = getId(item);

		if (!cursor) {
			return { rank, id, maxId: id };
		}

		const { maxId: cursorMaxId } = cursor;
		const maxId = id > cursorMaxId ? id : cursorMaxId;

		if (rank >= cursor.rank) {
			return { rank, id, maxId };
		} else {
			return { rank: cursor.rank, id: cursor.id, maxId };
		}
	};
}
