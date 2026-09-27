import { noopLogger } from "@aikirun/lib/logger";
import type { CreateCodec } from "@aikirun/types/infra/codec";

import { client } from "./client";
import { describe, expect, test } from "bun:test";

const handler = async () => new Response();

describe("client codec output must survive a JSON round trip", () => {
	test("accepts a client without a codec", () => {
		expect(client({ handler, logger: noopLogger })).toBeDefined();
	});

	test("accepts a hand-written codec that encodes to a string", () => {
		client({
			handler,
			logger: noopLogger,
			codec: () => ({
				encode: async (payload) => JSON.stringify(payload),
				decode: async (encoded) => JSON.parse(String(encoded)),
			}),
		});
	});

	test("accepts a codec defined elsewhere and passed by name", () => {
		const jsonCodec: CreateCodec<string> = () => ({
			encode: async (payload) => JSON.stringify(payload),
			decode: async (encoded) => JSON.parse(String(encoded)),
		});
		client({ handler, logger: noopLogger, codec: jsonCodec });
	});

	test("rejects a hand-written codec that encodes to raw bytes", () => {
		// @ts-expect-error encoded.iv is binary data
		client({
			handler,
			logger: noopLogger,
			codec: () => ({
				encode: async () => ({ iv: new Uint8Array(12), ct: "…" }),
				decode: async (encoded) => encoded,
			}),
		});
	});

	test("requires a hand-written codec to declare its output type", () => {
		// @ts-expect-error CreateCodec requires its Encoded type argument
		const erased: CreateCodec = () => ({
			encode: async (payload: unknown) => JSON.stringify(payload),
			decode: async (encoded: unknown) => JSON.parse(String(encoded)),
		});
		expect(erased).toBeDefined();
	});
});
