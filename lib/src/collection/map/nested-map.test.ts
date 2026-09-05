import { type NestedMap, nestedMap } from "./nested-map";
import { describe, expect, expectTypeOf, test } from "bun:test";

interface Row {
	region: string;
	tier: number;
	active: boolean;
}

describe("nestedMap", () => {
	test("the type nests one Map per key, with the item type at the leaf", () => {
		expectTypeOf<NestedMap<Row, ["region", "tier"]>>().toEqualTypeOf<Map<string, Map<number, Row>>>();
		expectTypeOf<NestedMap<Row, ["active"]>>().toEqualTypeOf<Map<boolean, Row>>();
		expectTypeOf(nestedMap([] as Row[], "region", "tier")).toEqualTypeOf<Map<string, Map<number, Row>>>();
	});

	test("builds one Map per key, with the item at the leaf", () => {
		const euGold = { region: "eu", tier: 1, active: true };
		const euSilver = { region: "eu", tier: 2, active: true };
		const usGold = { region: "us", tier: 1, active: false };

		expect(nestedMap([euGold, euSilver, usGold], "region", "tier")).toEqual(
			new Map([
				[
					"eu",
					new Map([
						[1, euGold],
						[2, euSilver],
					]),
				],
				["us", new Map([[1, usGold]])],
			])
		);
	});

	test("with one key the leaf is the item itself", () => {
		const eu = { region: "eu", tier: 1, active: true };
		const us = { region: "us", tier: 1, active: false };

		expect(nestedMap([eu, us], "region")).toEqual(
			new Map([
				["eu", eu],
				["us", us],
			])
		);
	});

	test("a later item with the same key path replaces the earlier one", () => {
		const first = { region: "eu", tier: 1, active: true };
		const second = { region: "eu", tier: 1, active: false };

		expect(nestedMap([first, second], "region", "tier")).toEqual(new Map([["eu", new Map([[1, second]])]]));
	});

	test("two items whose key values would join to the same string stay distinct", () => {
		const colonInRegion = { region: "eu:west", zone: "1" };
		const colonInZone = { region: "eu", zone: "west:1" };

		expect(nestedMap([colonInRegion, colonInZone], "region", "zone")).toEqual(
			new Map([
				["eu:west", new Map([["1", colonInRegion]])],
				["eu", new Map([["west:1", colonInZone]])],
			])
		);
	});
});
