import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";

import { event } from "./definition";

const appendBangSchema: StandardSchemaV1<string> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) => ({ value: `${String(value)}!` }),
	},
};

describe("event", () => {
	test("carries no schema by default", () => {
		expect(event().schema).toBeUndefined();
	});

	test("carries the provided schema", () => {
		expect(event({ schema: appendBangSchema }).schema).toBe(appendBangSchema);
	});
});
