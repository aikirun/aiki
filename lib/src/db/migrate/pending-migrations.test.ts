import { findPendingMigrationTags } from "./pending-migrations";
import { describe, expect, test } from "bun:test";

describe("findPendingMigrationTags", () => {
	const journal = {
		entries: [
			{ tag: "0000_create_invoice", when: 1_700_000_000_000 },
			{ tag: "0001_add_due_date", when: 1_700_000_001_000 },
			{ tag: "0002_add_currency", when: 1_700_000_002_000 },
		],
	};

	test("lists the journal tags the database has not applied, in journal order", () => {
		expect(findPendingMigrationTags(journal, ["0001_add_due_date"])).toEqual([
			"0000_create_invoice",
			"0002_add_currency",
		]);
	});

	test("lists nothing when the database has applied every journal tag", () => {
		expect(
			findPendingMigrationTags(journal, ["0002_add_currency", "0000_create_invoice", "0001_add_due_date"])
		).toEqual([]);
	});

	test("ignores applied tags the journal does not list", () => {
		expect(
			findPendingMigrationTags(journal, [
				"0000_create_invoice",
				"0001_add_due_date",
				"0002_add_currency",
				"0003_add_tax_rate",
			])
		).toEqual([]);
	});
});
