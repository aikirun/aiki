import { describe, expect, test } from "vitest";

import { defaultServerRuntimeConfig } from "./defaults";
import { validateServerRuntimeConfig } from "./schema";

describe("validateServerRuntimeConfig", () => {
	test("accepts the defaults", () => {
		expect(validateServerRuntimeConfig(defaultServerRuntimeConfig)).toEqual({ valid: true });
	});
});
