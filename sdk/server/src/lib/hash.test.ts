import { candidateHashes } from "./hash";
import { describe, expect, test } from "bun:test";

describe("candidateHashes", () => {
	test("is the current value alone when the hash carries no others", () => {
		expect(candidateHashes({ value: "h2" })).toEqual(["h2"]);
	});

	test("lists the deprecated values", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h0", "h1"] })).toEqual(["h2", "h0", "h1"]);
	});

	test("lists the deprecated values and the next value after the current one", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h0", "h1"], nextValue: "h3" })).toEqual([
			"h2",
			"h0",
			"h1",
			"h3",
		]);
	});

	test("drops a value that appears more than once", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h2"], nextValue: "h2" })).toEqual(["h2"]);
	});
});
