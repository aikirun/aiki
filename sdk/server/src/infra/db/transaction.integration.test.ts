import type { TxRepositories } from "./types";
import { describe, expect, test } from "bun:test";
import { withRepos } from "../../testing/harness";

describe("transaction onCommit", () => {
	test("runs effects after the transaction body, before the transaction call resolves", () =>
		withRepos(async (repos) => {
			const events: string[] = [];

			await repos.transaction(async (txRepos) => {
				txRepos.onCommit(() => {
					events.push("effect");
				});
				events.push("body done");
			});
			events.push("transaction resolved");

			expect(events).toEqual(["body done", "effect", "transaction resolved"]);
		}));

	test("drops effects when the transaction rolls back", () =>
		withRepos(async (repos) => {
			const events: string[] = [];

			const transactionPromise = repos.transaction(async (txRepos) => {
				txRepos.onCommit(() => {
					events.push("effect");
				});
				throw new Error("rollback");
			});

			expect(transactionPromise).rejects.toThrow("rollback");
			expect(events).toEqual([]);
		}));

	test("effects registered by nested calls all fire at the one commit", () =>
		withRepos(async (repos) => {
			const events: string[] = [];
			const registerFromNestedCall = async (txRepos: TxRepositories) => {
				txRepos.onCommit(() => {
					events.push("nested effect");
				});
			};

			await repos.transaction(async (txRepos) => {
				txRepos.onCommit(() => {
					events.push("owner effect");
				});
				await registerFromNestedCall(txRepos);
			});

			expect(events).toEqual(["owner effect", "nested effect"]);
		}));
});
