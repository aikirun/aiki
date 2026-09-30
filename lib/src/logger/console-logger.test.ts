import { createConsoleLogger } from "./console-logger";
import { afterAll, describe, expect, spyOn, test } from "bun:test";

describe("createConsoleLogger", () => {
	const consoleError = spyOn(console, "error").mockImplementation(() => {});

	afterAll(() => {
		consoleError.mockRestore();
	});

	test("prints the errors an error wraps after its stack", () => {
		const diskError = Object.assign(new Error("disk quota exceeded"), { code: "EDQUOT" });
		const exportError = new Error("export failed", { cause: diskError });

		createConsoleLogger().error("Export failed", { err: exportError });

		expect(consoleError.mock.calls.map(([output]) => withoutColors(String(output)))).toEqual([
			expect.stringMatching(
				/ {2}err: Error: export failed\n {4}at [\s\S]*\n {2}Caused by: Error \[EDQUOT\]: disk quota exceeded$/
			),
		]);
	});

	function withoutColors(output: string): string {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matches the escape codes the logger colors its output with
		return output.replace(/\x1b\[[0-9;]*m/g, "");
	}
});
