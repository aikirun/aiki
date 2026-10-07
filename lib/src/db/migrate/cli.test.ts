import process from "node:process";
import { afterAll, describe, expect, test, vi } from "vitest";

import { runMigrateCli } from "./cli";
import { migrationSource } from "./source";

describe("runMigrateCli", () => {
	// The tests run at the same time and share these, so each asserts only what its own call did.
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
	const processExit = vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`process.exit(${code})`);
	});
	const originalArgv = process.argv;

	afterAll(() => {
		process.argv = originalArgv;
		processExit.mockRestore();
		consoleLog.mockRestore();
		consoleError.mockRestore();
	});

	const cliParams = {
		name: "widget-app",
		version: "1.2.3",
		resolveSource: () => migrationSource({ journal: { entries: [] }, files: {} }),
		migrationsTable: "widget_migrations",
	};

	test("an unknown command prints an error and exits with code 1", async () => {
		process.argv = ["node", "widget-app", "server", "start"];

		await expect(runMigrateCli(cliParams)).rejects.toThrow("process.exit(1)");

		expect(consoleError.mock.calls).toEqual(
			expect.arrayContaining([['Unknown command "server". Expected one of: migrate.']])
		);
	});

	test("asking a command for help is not an unknown command", async () => {
		process.argv = ["node", "widget-app", "migrate", "list", "--help"];

		await expect(runMigrateCli(cliParams)).resolves.toBeUndefined();
	});
});
