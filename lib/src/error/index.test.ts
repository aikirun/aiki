import { asAikiError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "./index";
import { describe, expect, test } from "bun:test";

describe("asAikiError", () => {
	// Bundlers inline lib into every package that depends on it, so an error thrown inside one
	// package is built by a different constructor than the class another package imports.
	// This stands in for that second copy.
	class UnauthorizedErrorFromAnotherBundle extends Error {
		readonly code = "UNAUTHORIZED";
		readonly status = 401;

		constructor(message: string) {
			super(message);
			this.name = "UnauthorizedError";
		}
	}

	test("reports how every error lib defines should be returned", () => {
		expect(
			[
				new NotFoundError("message"),
				new ValidationError("message"),
				new UnauthorizedError("message"),
				new ForbiddenError("message"),
				new ConflictError("message"),
			].map((err) => [asAikiError(err)?.code, asAikiError(err)?.status])
		).toEqual([
			["NOT_FOUND", 404],
			["BAD_REQUEST", 400],
			["UNAUTHORIZED", 401],
			["FORBIDDEN", 403],
			["CONFLICT", 409],
		]);
	});

	test("recognises an error built by another copy of the class", () => {
		const err = new UnauthorizedErrorFromAnotherBundle("Invalid API key");

		expect(err instanceof UnauthorizedError).toBe(false);
		expect([asAikiError(err)?.code, asAikiError(err)?.status]).toEqual(["UNAUTHORIZED", 401]);
	});

	test("declines an error that carries a code but no status", () => {
		const err = Object.assign(new Error("no such file"), { code: "ENOENT" });

		expect(asAikiError(err)).toBeUndefined();
	});

	test("declines values that are not errors", () => {
		expect([
			asAikiError({ code: "UNAUTHORIZED", status: 401 }),
			asAikiError("UNAUTHORIZED"),
			asAikiError(undefined),
		]).toEqual([undefined, undefined, undefined]);
	});
});
