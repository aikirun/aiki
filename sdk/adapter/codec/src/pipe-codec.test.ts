import { noopLogger } from "@aikirun/lib/logger";

import { codec } from "./codec";
import { pipeCodecs } from "./pipe-codec";
import { describe, expect, test } from "bun:test";

describe("pipeCodecs", () => {
	const inner = codec({
		name: "inner",
		encode: (payload) => ({ inner: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("inner" in body)) {
				throw new Error("unexpected inner body");
			}
			return body.inner;
		},
	});
	const middle = codec({
		name: "middle",
		encode: (payload) => ({ middle: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("middle" in body)) {
				throw new Error("unexpected middle body");
			}
			return body.middle;
		},
	});
	const outer = codec({
		name: "outer",
		encode: (payload) => ({ outer: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("outer" in body)) {
				throw new Error("unexpected outer body");
			}
			return body.outer;
		},
	});
	const piped = pipeCodecs(inner, middle, outer)({ logger: noopLogger });

	test("encode stacks codecs in order", async () => {
		const payload = { name: "alice" };
		expect(await piped.encode(payload)).toEqual({
			codecName: "outer",
			body: {
				outer: {
					codecName: "middle",
					body: {
						middle: {
							codecName: "inner",
							body: { inner: payload },
						},
					},
				},
			},
		});
	});

	test("decode reverses the stack and recovers the payload", async () => {
		const payload = { name: "alice" };
		const encoded = await piped.encode(payload);
		expect(await piped.decode(encoded)).toEqual(payload);
	});

	test("exposes the outermost codec name", () => {
		expect(pipeCodecs(inner, middle, outer).codecName).toBe("outer");
		expect(pipeCodecs(inner).codecName).toBe("inner");
	});
});
