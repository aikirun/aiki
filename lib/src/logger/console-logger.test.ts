import { describe, expect, test, vi } from "vitest";

import { createConsoleLogger } from "./console-logger";

describe("createConsoleLogger", () => {
	test("prints each entry as one JSON line by default", () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
		try {
			const earliestLogTime = Date.now();
			createConsoleLogger().info("Payment authorized", { orderId: "order-1" });
			const latestLogTime = Date.now();

			const lines = consoleInfo.mock.calls.map(([line]) => String(line));
			expect(lines).toEqual([expect.not.stringContaining("\n")]);
			const { time, ...entry } = JSON.parse(lines.join(""));
			expect(entry).toEqual({ level: "info", orderId: "order-1", msg: "Payment authorized" });
			expect(time).toBeGreaterThanOrEqual(earliestLogTime);
			expect(time).toBeLessThanOrEqual(latestLogTime);
		} finally {
			consoleInfo.mockRestore();
		}
	});

	test("does not print an entry below its level", () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
		try {
			createConsoleLogger({ level: "warn" }).info("Payment authorized");

			expect(consoleInfo.mock.calls).toEqual([]);
		} finally {
			consoleInfo.mockRestore();
		}
	});

	test("prints an entry at its level", () => {
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			createConsoleLogger({ level: "warn" }).warn("Payment retried");

			expect(consoleWarn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
				expect.objectContaining({ level: "warn", msg: "Payment retried" }),
			]);
		} finally {
			consoleWarn.mockRestore();
		}
	});

	test("adds a child's bindings to each entry", () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
		try {
			createConsoleLogger().child({ service: "billing" }).info("Payment authorized", { orderId: "order-1" });

			expect(consoleInfo.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
				expect.objectContaining({ service: "billing", orderId: "order-1", msg: "Payment authorized" }),
			]);
		} finally {
			consoleInfo.mockRestore();
		}
	});

	test("writes an error as its name, message, stack and the errors it wraps", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const diskError = Object.assign(new Error("disk quota exceeded"), { code: "EDQUOT" });
			const exportError = new Error("export failed", { cause: diskError });

			createConsoleLogger().error("Export failed", { err: exportError });

			expect(consoleError.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
				expect.objectContaining({
					msg: "Export failed",
					err: {
						name: "Error",
						message: "export failed",
						stack: exportError.stack,
						causes: ["Error [EDQUOT]: disk quota exceeded"],
					},
				}),
			]);
		} finally {
			consoleError.mockRestore();
		}
	});

	test("pretty: prints the errors an error wraps after its stack", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const diskError = Object.assign(new Error("disk quota exceeded"), { code: "EDQUOT" });
			const exportError = new Error("export failed", { cause: diskError });

			createConsoleLogger({ pretty: true }).error("Export failed", { err: exportError });

			expect(consoleError.mock.calls.map(([output]) => withoutColors(String(output)))).toEqual([
				expect.stringMatching(
					/ {2}err: Error: export failed\n {4}at [\s\S]*\n {2}Caused by: Error \[EDQUOT\]: disk quota exceeded$/
				),
			]);
		} finally {
			consoleError.mockRestore();
		}
	});

	function withoutColors(output: string): string {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matches the escape codes the logger colors its output with
		return output.replace(/\x1b\[[0-9;]*m/g, "");
	}
});
