import type { ContextBase } from "@aikirun/lib/context";
import { NotFoundError } from "@aikirun/lib/error";
import { noopLogger } from "@aikirun/lib/logger";
import { ORPCError, ValidationError } from "@orpc/server";
import { describe, expect, test, vi } from "vitest";

import { handleError } from "./error-handler";

function createContext(logger = noopLogger): ContextBase {
	return {
		type: "daemon",
		traceId: "trace-1",
		spanId: "span-1",
		logger,
	};
}

describe("handleError", () => {
	test("re-throws an input validation error as BAD_REQUEST with problems, without logging", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const cause = new ValidationError({ message: "bad input", issues: [{ message: "name is required" }] });
		const err = new ORPCError("BAD_REQUEST", { message: "Input validation failed", status: 400, cause });

		expect(() => handleError(createContext(logger), err)).toThrow("Input validation failed: name is required");
		expect(logger.error.mock.calls).toEqual([]);
	});

	test("logs and re-throws an output validation error with problems", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const issues = [{ message: "status must be a string" }, { message: "count must be a number" }];
		const cause = new ValidationError({ message: "Output validation failed", issues });
		const err = new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Output validation failed",
			status: 500,
			cause,
		});

		expect(() => handleError(createContext(logger), err)).toThrow(ORPCError);

		expect(logger.error.mock.calls).toEqual([["Output validation failed", { err, "aiki.validationIssues": issues }]]);
	});

	test("includes the problem list in the re-thrown output validation error message", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const cause = new ValidationError({
			message: "Output validation failed",
			issues: [{ message: "field a is wrong" }, { message: "field b is missing" }],
		});
		const err = new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Output validation failed",
			status: 500,
			cause,
		});

		let thrown: ORPCError<string, unknown> | undefined;
		try {
			handleError(createContext(logger), err);
		} catch (e) {
			thrown = e as ORPCError<string, unknown>;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		expect(thrown?.message).toBe("Output validation failed: field a is wrong; field b is missing");
		expect(thrown?.status).toBe(500);
	});

	test("re-throws an Aiki error with status below 500 without logging", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const err = new NotFoundError("Namespace not found");

		expect(() => handleError(createContext(logger), err)).toThrow(ORPCError);
		expect(logger.error.mock.calls).toEqual([]);
	});

	test("logs an Aiki error with status 500 or above before re-throwing", () => {
		const logger = { ...noopLogger, error: vi.fn() };

		class ServerSideAikiError extends Error {
			readonly code = "INTERNAL_SERVER_ERROR";
			readonly status = 500;
		}
		const err = new ServerSideAikiError("something broke");

		expect(() => handleError(createContext(logger), err)).toThrow(ORPCError);
		expect(logger.error.mock.calls).toEqual([["Request error occurred", { err }]]);
	});

	test("logs an unknown error with its cause and re-throws it unchanged", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const err = new Error("unexpected");

		expect(() => handleError(createContext(logger), err)).toThrow(err);
		expect(logger.error.mock.calls).toEqual([["Request error occurred", { err }]]);
	});

	test("attaches validation issues from the cause of an unknown error", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		const issues = [{ message: "bad value" }];
		const err = new Error("unexpected", { cause: { issues } });

		expect(() => handleError(createContext(logger), err)).toThrow(err);
		expect(logger.error.mock.calls).toEqual([["Request error occurred", { err, "aiki.validationIssues": issues }]]);
	});
});
