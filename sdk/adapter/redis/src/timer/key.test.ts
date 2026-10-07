import { describe, expect, test } from "vitest";

import { getTimerKeys } from "./key";

describe("getTimerKeys", () => {
	test("uses a key that has a hash tag as given, with the signal key under the same tag", () => {
		expect(getTimerKeys("aiki:{timers}")).toEqual({ timersKey: "aiki:{timers}", signalKey: "aiki:{timers}:signal" });
	});

	test("wraps a key that has no hash tag in braces for the signal key", () => {
		expect(getTimerKeys("aiki:timers")).toEqual({ timersKey: "aiki:timers", signalKey: "{aiki:timers}:signal" });
	});

	test("escapes braces in a key that has no hash tag so they cannot end the signal key's hash tag early", () => {
		expect(getTimerKeys("ti}mers{")).toEqual({ timersKey: "ti%7Dmers%7B", signalKey: "{ti%7Dmers%7B}:signal" });
	});

	test("escapes a percent sign so an escaped key cannot collide with one typed that way", () => {
		expect(getTimerKeys("ti%7Dmers")).toEqual({ timersKey: "ti%257Dmers", signalKey: "{ti%257Dmers}:signal" });
	});

	test("does not take an empty pair of braces for a hash tag", () => {
		expect(getTimerKeys("aiki:{}timers")).toEqual({
			timersKey: "aiki:%7B%7Dtimers",
			signalKey: "{aiki:%7B%7Dtimers}:signal",
		});
	});

	test("looks for a hash tag only at the key's first opening brace", () => {
		expect(getTimerKeys("{}aiki:{timers}")).toEqual({
			timersKey: "%7B%7Daiki:%7Btimers%7D",
			signalKey: "{%7B%7Daiki:%7Btimers%7D}:signal",
		});
	});
});
