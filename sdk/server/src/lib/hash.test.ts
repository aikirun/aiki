import { describe, expect, test } from "vitest";

import { candidateHashes } from "./hash";

describe("candidateHashes", () => {
	test("is the current value alone when the hash carries no others", () => {
		expect(candidateHashes({ value: "h2" })).toEqual({ current: "h2", all: ["h2"] });
	});

	test("lists the deprecated values", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h0", "h1"] })).toEqual({
			current: "h2",
			all: ["h2", "h0", "h1"],
		});
	});

	test("lists the deprecated values and the next values after the current one", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h0", "h1"], nextValues: ["h3", "h4"] })).toEqual({
			current: "h2",
			all: ["h2", "h0", "h1", "h3", "h4"],
		});
	});

	test("lists a deprecated nextValue after the next values", () => {
		expect(candidateHashes({ value: "h2", nextValues: ["h3"], nextValue: "h4" })).toEqual({
			current: "h2",
			all: ["h2", "h3", "h4"],
		});
	});

	test("drops a value that appears more than once", () => {
		expect(candidateHashes({ value: "h2", deprecatedValues: ["h2"], nextValues: ["h2"], nextValue: "h2" })).toEqual({
			current: "h2",
			all: ["h2"],
		});
	});
});
