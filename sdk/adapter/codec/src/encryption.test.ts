import { asConfigProvider, type CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { stableStringify } from "@aikirun/lib/json";
import { noopLogger } from "@aikirun/lib/logger";
import { describe, expect, expectTypeOf, test } from "vitest";

import type { EncodedValue, NamedCreateCodec } from "./codec";
import {
	type EncryptedValue,
	type EncryptionConfig,
	EncryptionDecryptFailedError,
	EncryptionKeyNotFoundError,
	encryption,
	InvalidEncryptionKeyError,
} from "./encryption";

const context = { logger: noopLogger };

function randomKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

describe("encryption codec", () => {
	const keyA = randomKey();
	const keyB = randomKey();
	const keyC = randomKey();
	const keys = new Map<string, Uint8Array>([
		["a", keyA],
		["b", keyB],
		["c", keyC],
	]);

	const resolveKey = (keyId: string): Uint8Array | null => keys.get(keyId) ?? null;

	test("round-trips a payload", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);
		const payload = { name: "alice", count: 3 };

		const encoded = await instance.encode(payload);
		expect(encoded.codecName).toBe("AES-256-GCM");
		expect(encoded.body.keyId).toBe("a");
		expect(typeof encoded.body.ciphertext).toBe("string");
		expect(encoded.body.ciphertext.length).toBeGreaterThan(0);
		expect(await instance.decode(encoded)).toEqual(payload);
	});

	test("round-trips undefined", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);

		const encoded = await instance.encode(undefined);
		expect(await instance.decode(encoded)).toBeUndefined();
	});

	test("decrypts a value written under an old key after config advances", async () => {
		const config: EncryptionConfig = { keyId: "a" };
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config,
		});
		const instance = createCodec(context);

		const encoded = await instance.encode({ orderId: "1" });
		expect(encoded.body.keyId).toBe("a");

		config.keyId = "b";
		config.previousKeyIds = ["a"];

		expect(await instance.decode(encoded)).toEqual({ orderId: "1" });
		const nextEncoded = await instance.encode({ orderId: "2" });
		expect(nextEncoded.body.keyId).toBe("b");
	});

	test("decodes a key id that is absent from every config field but resolved by key fn", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "b" },
		});
		const writer = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		}).codec(context);
		const encoded = await writer.encode({ orphan: true });

		expect(await createCodec(context).decode(encoded)).toEqual({ orphan: true });
	});

	test("throws EncryptionKeyNotFoundError when the resolver returns null on encode", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "missing" },
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toMatchObject({
			name: "EncryptionKeyNotFoundError",
			keyId: "missing",
			message: 'Encryption key "missing" was not found',
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toBeInstanceOf(EncryptionKeyNotFoundError);
	});

	test("throws EncryptionKeyNotFoundError when the resolver returns null on decode", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: () => null,
			config: { keyId: "a" },
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "gone", ciphertext: "AAAA" },
			})
		).rejects.toMatchObject({
			name: "EncryptionKeyNotFoundError",
			keyId: "gone",
		});
	});

	test("propagates a thrown resolver error on encode and does not treat it as missing", async () => {
		const vaultError = new Error("vault unreachable");
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: () => {
				throw vaultError;
			},
			config: { keyId: "a" },
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toBe(vaultError);
	});

	test("propagates a rejected resolver promise on decode", async () => {
		const vaultError = new Error("vault unreachable");
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: async () => {
				throw vaultError;
			},
			config: { keyId: "a" },
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a", ciphertext: "AAAA" },
			})
		).rejects.toBe(vaultError);
	});

	test("rejects an invalid encrypted body as EncryptionDecryptFailedError", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a" },
			})
		).rejects.toBeInstanceOf(EncryptionDecryptFailedError);
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a" },
			})
		).rejects.toMatchObject({
			name: "EncryptionDecryptFailedError",
			message: "Encrypted body does not fit { keyId, ciphertext }",
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "", ciphertext: "AAAA" },
			})
		).rejects.toMatchObject({
			name: "EncryptionDecryptFailedError",
			message: "Encrypted body does not fit { keyId, ciphertext }",
		});
	});

	test("rejects an empty keyId without calling the key resolver", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: () => {
				throw new Error("resolver should not be called");
			},
			config: { keyId: "" },
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toMatchObject({
			name: "EncryptionKeyNotFoundError",
			keyId: "",
		});
	});

	test("rejects ciphertext shorter than IV plus tag as EncryptionDecryptFailedError", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a", ciphertext: "AAAA" },
			})
		).rejects.toBeInstanceOf(EncryptionDecryptFailedError);
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a", ciphertext: "AAAA" },
			})
		).rejects.toMatchObject({
			keyId: "a",
		});
		await expect(
			createCodec(context).decode({
				codecName: "AES-256-GCM",
				body: { keyId: "a", ciphertext: Buffer.alloc(27).toString("base64") },
			})
		).rejects.toMatchObject({
			keyId: "a",
		});
	});

	test("rejects ciphertext that is not exact standard base64 as EncryptionDecryptFailedError", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);
		const encoded = await instance.encode({ n: 1 });

		await expect(
			instance.decode({
				codecName: encoded.codecName,
				body: { keyId: "a", ciphertext: ` ${encoded.body.ciphertext}` },
			})
		).rejects.toMatchObject({
			name: "EncryptionDecryptFailedError",
			keyId: "a",
		});
		await expect(
			instance.decode({
				codecName: encoded.codecName,
				body: { keyId: "a", ciphertext: `${encoded.body.ciphertext}!` },
			})
		).rejects.toMatchObject({
			name: "EncryptionDecryptFailedError",
			keyId: "a",
		});
	});

	test("rejects a tampered ciphertext as EncryptionDecryptFailedError", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);
		const encoded = await instance.encode({ n: 1 });
		const packed = Buffer.from(encoded.body.ciphertext, "base64");
		const lastIndex = packed.byteLength - 1;
		packed.writeUInt8(packed.readUInt8(lastIndex) ^ 0xff, lastIndex);
		const tampered = {
			codecName: encoded.codecName,
			body: { keyId: encoded.body.keyId, ciphertext: packed.toString("base64") },
		};
		await expect(instance.decode(tampered)).rejects.toBeInstanceOf(EncryptionDecryptFailedError);
		await expect(instance.decode(tampered)).rejects.toMatchObject({
			keyId: "a",
			cause: expect.objectContaining({ name: "OperationError" }),
		});
	});

	test("rejects a swapped keyId when both ids resolve to the same key material", async () => {
		const sharedKey = randomKey();
		const sharedKeys = new Map<string, Uint8Array>([
			["a", sharedKey],
			["b", sharedKey],
		]);
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => sharedKeys.get(keyId) ?? null,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);
		const encoded = await instance.encode({ n: 1 });
		const swapped = {
			codecName: encoded.codecName,
			body: { keyId: "b", ciphertext: encoded.body.ciphertext },
		};
		await expect(instance.decode(swapped)).rejects.toBeInstanceOf(EncryptionDecryptFailedError);
		await expect(instance.decode(swapped)).rejects.toMatchObject({
			keyId: "b",
			cause: expect.objectContaining({ name: "OperationError" }),
		});
	});

	test("rejects key material that is not 32 bytes", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: () => new Uint8Array(16),
			config: { keyId: "a" },
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toMatchObject({
			name: "InvalidEncryptionKeyError",
			keyId: "a",
			byteLength: 16,
		});
		await expect(createCodec(context).encode({ x: 1 })).rejects.toBeInstanceOf(InvalidEncryptionKeyError);
	});

	test("reads config from a provider on each encode", async () => {
		let keyId = "a";
		const configProvider: CreatePassiveConfigProvider<EncryptionConfig> = () => asConfigProvider(() => ({ keyId }));
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: configProvider,
		});
		const instance = createCodec(context);

		expect((await instance.encode({ n: 1 })).body.keyId).toBe("a");
		keyId = "b";
		expect((await instance.encode({ n: 2 })).body.keyId).toBe("b");
	});

	test("resolves key material only on a cache miss", async () => {
		let resolveCount = 0;
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});
		const instance = createCodec(context);

		const encoded = await instance.encode({ n: 1 });
		expect(resolveCount).toBe(1);
		expect(await instance.decode(encoded)).toEqual({ n: 1 });
		expect(resolveCount).toBe(1);
		await instance.encode({ n: 2 });
		expect(resolveCount).toBe(1);
	});

	test("shares the derived key cache across codec contexts", async () => {
		let resolveCount = 0;
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});

		await createCodec(context).encode({ n: 1 });
		expect(resolveCount).toBe(1);
		await createCodec({ logger: noopLogger }).encode({ n: 2 });
		expect(resolveCount).toBe(1);
	});

	test("shares the derived key cache between codec and hasher", async () => {
		let resolveCount = 0;
		const { codec: createCodec, hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});

		await createCodec(context).encode({ n: 1 });
		expect(resolveCount).toBe(1);
		await createHasher(context)({ orderId: "1" });
		expect(resolveCount).toBe(1);
	});

	test("deduplicates concurrent resolves for the same key id", async () => {
		let resolveCount = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: async (keyId) => {
				resolveCount += 1;
				await gate;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});
		const instance = createCodec(context);

		const first = instance.encode({ n: 1 });
		const second = instance.encode({ n: 2 });
		release();
		await Promise.all([first, second]);
		expect(resolveCount).toBe(1);
	});

	test("re-resolves on every use when keyCache is false", async () => {
		let resolveCount = 0;
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
			keyCache: false,
		});
		const instance = createCodec(context);

		await instance.encode({ n: 1 });
		await instance.encode({ n: 2 });
		expect(resolveCount).toBe(2);
	});

	test("ttlMs 0 re-resolves so a revoked key fails on the next decode", async () => {
		const liveKeys = new Map(keys);
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => liveKeys.get(keyId) ?? null,
			config: { keyId: "a" },
			keyCache: { ttlMs: 0 },
		});
		const instance = createCodec(context);
		const encoded = await instance.encode({ n: 1 });

		liveKeys.delete("a");
		await expect(instance.decode(encoded)).rejects.toMatchObject({
			name: "EncryptionKeyNotFoundError",
			keyId: "a",
		});
	});

	test("evicts the oldest ready key when maxEntries is exceeded", async () => {
		let resolveCount = 0;
		const encodedUnderA = await encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		})
			.codec(context)
			.encode({ n: 1 });
		const encodedUnderB = await encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "b" },
		})
			.codec(context)
			.encode({ n: 2 });

		const instance = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
			keyCache: { maxEntries: 1 },
		}).codec(context);

		expect(await instance.decode(encodedUnderA)).toEqual({ n: 1 });
		expect(resolveCount).toBe(1);
		expect(await instance.decode(encodedUnderB)).toEqual({ n: 2 });
		expect(resolveCount).toBe(2);
		expect(await instance.decode(encodedUnderA)).toEqual({ n: 1 });
		expect(resolveCount).toBe(3);
	});

	test("does not retain a null resolve so a later material succeeds", async () => {
		const liveKeys = new Map<string, Uint8Array>();
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => liveKeys.get(keyId) ?? null,
			config: { keyId: "a" },
		});
		const instance = createCodec(context);

		await expect(instance.encode({ n: 1 })).rejects.toBeInstanceOf(EncryptionKeyNotFoundError);
		liveKeys.set("a", keyA);
		expect(await instance.decode(await instance.encode({ n: 1 }))).toEqual({ n: 1 });
	});

	test("does not use the master key bytes as a raw AES-GCM key", async () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const encoded = await createCodec(context).encode({ n: 1 });
		const packed = new Uint8Array(Buffer.from(encoded.body.ciphertext, "base64"));
		const iv = packed.subarray(0, 12);
		const ciphertext = packed.subarray(12);
		const rawAesKey = await crypto.subtle.importKey("raw", new Uint8Array(keyA), { name: "AES-GCM" }, false, [
			"decrypt",
		]);

		await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, rawAesKey, ciphertext)).rejects.toThrow();
	});
});

describe("encryption hasher", () => {
	const keyA = randomKey();
	const keyB = randomKey();
	const keyNext = randomKey();
	const keys = new Map<string, Uint8Array>([
		["a", keyA],
		["b", keyB],
		["next", keyNext],
		["orphan", randomKey()],
	]);
	const resolveKey = (keyId: string): Uint8Array | null => keys.get(keyId) ?? null;

	test("hashes under keyId and announces previous and next rotations", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "b", previousKeyIds: ["a"], nextKeyId: "next" },
		});
		const hasher = createHasher(context);
		const input = { orderId: "42" };

		const hash = await hasher(input);
		expect(hash.value.startsWith("b:")).toBe(true);
		expect(hash.deprecatedValues).toEqual([expect.stringMatching(/^a:/)]);
		expect(hash.nextValue).toEqual(expect.stringMatching(/^next:/));
		expect(hash.value).not.toBe(hash.deprecatedValues?.[0]);
		expect(hash.value).not.toBe(hash.nextValue);
	});

	test("for binds to the stamped key id even when absent from config", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "b" },
		});
		const hasher = createHasher(context);
		const written = await encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "orphan" },
		}).hasher(context)({ orderId: "7" });

		const bound = await hasher.for(written.value);
		expect(bound).not.toBeNull();
		if (bound === null) {
			return;
		}
		expect(await bound({ orderId: "7" })).toBe(written.value);
		expect(await bound({ orderId: "8" })).not.toBe(written.value);
	});

	test("for binds when the key id itself contains colons", async () => {
		const kmsKeyId = "arn:aws:kms:us-east-1:123456789012:key/abcd";
		keys.set(kmsKeyId, randomKey());
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: kmsKeyId },
		});
		const hasher = createHasher(context);
		const written = await hasher({ orderId: "7" });

		expect(written.value.startsWith(`${kmsKeyId}:`)).toBe(true);
		const bound = await hasher.for(written.value);
		expect(bound).not.toBeNull();
		if (bound === null) {
			return;
		}
		expect(await bound({ orderId: "7" })).toBe(written.value);
	});

	test("for returns null when the resolver returns null", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const hasher = createHasher(context);
		expect(await hasher.for("missing:abc")).toBeNull();
	});

	test("for returns null for an unparsable hash", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		expect(await createHasher(context).for("nocolon")).toBeNull();
		expect(await createHasher(context).for(":onlydigest")).toBeNull();
		expect(await createHasher(context).for("onlykey:")).toBeNull();
	});

	test("for propagates a thrown resolver error instead of returning null", async () => {
		const vaultError = new Error("vault unreachable");
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				if (keyId === "a") {
					return keys.get("a") ?? null;
				}
				throw vaultError;
			},
			config: { keyId: "a" },
		});
		await expect(createHasher(context).for("b:abc")).rejects.toBe(vaultError);
	});

	test("throws EncryptionKeyNotFoundError when hashing and a listed key is missing", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a", previousKeyIds: ["gone"] },
		});

		await expect(createHasher(context)({ x: 1 })).rejects.toMatchObject({
			name: "EncryptionKeyNotFoundError",
			keyId: "gone",
		});
	});

	test("resolves key material only on a cache miss", async () => {
		let resolveCount = 0;
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});
		const hasher = createHasher(context);
		const input = { orderId: "1" };

		const hash = await hasher(input);
		expect(resolveCount).toBe(1);
		const bound = await hasher.for(hash.value);
		expect(resolveCount).toBe(1);
		expect(bound).not.toBeNull();
		if (bound === null) {
			return;
		}
		expect(await bound(input)).toBe(hash.value);
		expect(resolveCount).toBe(1);
	});

	test("shares the derived key cache across hasher contexts", async () => {
		let resolveCount = 0;
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => {
				resolveCount += 1;
				return resolveKey(keyId);
			},
			config: { keyId: "a" },
		});

		await createHasher(context)({ orderId: "1" });
		expect(resolveCount).toBe(1);
		await createHasher({ logger: noopLogger })({ orderId: "2" });
		expect(resolveCount).toBe(1);
	});

	test("ttlMs 0 re-resolves so a revoked key fails on hasher.for", async () => {
		const liveKeys = new Map(keys);
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: (keyId) => liveKeys.get(keyId) ?? null,
			config: { keyId: "a" },
			keyCache: { ttlMs: 0 },
		});
		const hasher = createHasher(context);
		const written = await hasher({ orderId: "1" });

		liveKeys.delete("a");
		expect(await hasher.for(written.value)).toBeNull();
	});

	test("does not use the master key bytes as a raw HMAC-SHA-256 key", async () => {
		const { hasher: createHasher } = encryption({
			name: "AES-256-GCM",
			key: resolveKey,
			config: { keyId: "a" },
		});
		const input = { orderId: "1" };
		const hash = await createHasher(context)(input);
		const rawHmacKey = await crypto.subtle.importKey(
			"raw",
			new Uint8Array(keyA),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		);
		const digest = new Uint8Array(
			await crypto.subtle.sign("HMAC", rawHmacKey, new TextEncoder().encode(stableStringify({ input })))
		);
		const rawHash = `a:${Buffer.from(digest).toString("base64url")}`;

		expect(hash.value).not.toBe(rawHash);
	});
});

describe("encryption codec output must survive a JSON round trip", () => {
	test("accepts the encrypted body shape", () => {
		const { codec: createCodec } = encryption({
			name: "AES-256-GCM",
			key: () => randomKey(),
			config: { keyId: "a" },
		});
		expectTypeOf(createCodec).toEqualTypeOf<NamedCreateCodec<EncodedValue<EncryptedValue>>>();
	});
});
