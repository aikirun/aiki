import { createKeysetStreamCursorAdvancer } from "./keyset-stream";
import { describe, expect, test } from "bun:test";

const advanceCursor = createKeysetStreamCursorAdvancer<{ order: number; id: string }>({
	getOrder: (item) => item.order,
	getId: (item) => item.id,
});

describe("createKeysetStreamCursorAdvancer", () => {
	test("the first row initializes the cursor", () => {
		expect(advanceCursor(undefined, { order: 100, id: "id-2" })).toEqual({
			order: 100,
			id: "id-2",
			maxSeenId: "id-2",
		});
	});

	test("a row past the frontier moves the frontier onto it", () => {
		const cursor = { order: 100, id: "id-1", maxSeenId: "id-1" };
		expect(advanceCursor(cursor, { order: 200, id: "id-2" })).toEqual({
			order: 200,
			id: "id-2",
			maxSeenId: "id-2",
		});
	});

	test("a row tied with the frontier's order still moves the frontier", () => {
		const cursor = { order: 100, id: "id-1", maxSeenId: "id-1" };
		expect(advanceCursor(cursor, { order: 100, id: "id-2" })).toEqual({
			order: 100,
			id: "id-2",
			maxSeenId: "id-2",
		});
	});

	test("a late-inserted row behind the frontier grows only maxSeenId", () => {
		const cursor = { order: 200, id: "id-2", maxSeenId: "id-2" };
		expect(advanceCursor(cursor, { order: 100, id: "id-3" })).toEqual({
			order: 200,
			id: "id-2",
			maxSeenId: "id-3",
		});
	});

	test("maxSeenId does not shrink when the frontier moves onto an older id", () => {
		// maxSeenId can sit above the frontier id: an earlier late-inserted row raised it
		// to id-9 while leaving the frontier at (100, id-1).
		const cursor = { order: 100, id: "id-1", maxSeenId: "id-9" };
		expect(advanceCursor(cursor, { order: 200, id: "id-2" })).toEqual({
			order: 200,
			id: "id-2",
			maxSeenId: "id-9",
		});
	});
});
