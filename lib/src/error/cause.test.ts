import { describe, expect, test } from "vitest";

import { describeErrorCauses } from "./cause";

describe("describeErrorCauses", () => {
	test("describes nothing for an error that wraps no other", () => {
		expect(describeErrorCauses(new Error("invoice not found"))).toEqual([]);
	});

	test("describes each wrapped error, outermost first, with its code when it has one", () => {
		const diskError = Object.assign(new Error("disk quota exceeded"), { code: "EDQUOT" });
		const uploadError = new Error("upload interrupted", { cause: diskError });
		const exportError = new Error("export failed", { cause: uploadError });

		expect(describeErrorCauses(exportError)).toEqual([
			"Error: upload interrupted",
			"Error [EDQUOT]: disk quota exceeded",
		]);
	});

	test("describes an AggregateError with no message by the messages of the errors it groups", () => {
		const mirrorsError = new AggregateError([new Error("mirror a timed out"), new Error("mirror b timed out")], "");
		const downloadError = new Error("download failed", { cause: mirrorsError });

		expect(describeErrorCauses(downloadError)).toEqual(["AggregateError: mirror a timed out; mirror b timed out"]);
	});

	test("describes a cause that is not an error as text", () => {
		const exportError = new Error("export failed", { cause: "disk full" });

		expect(describeErrorCauses(exportError)).toEqual(["disk full"]);
	});

	test("stops at an error it has already described", () => {
		const retryError = new Error("retry failed");
		const exportError = new Error("export failed", { cause: retryError });
		retryError.cause = exportError;

		expect(describeErrorCauses(exportError)).toEqual(["Error: retry failed"]);
	});
});
