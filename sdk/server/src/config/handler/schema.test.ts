import { describe, expect, test } from "vitest";

import { defaultServerHandlerConfig } from "./defaults";
import { validateServerHandlerConfig } from "./schema";

describe("validateServerHandlerConfig", () => {
	test("accepts the defaults", () => {
		expect(validateServerHandlerConfig(defaultServerHandlerConfig)).toEqual({ valid: true });
	});
});
