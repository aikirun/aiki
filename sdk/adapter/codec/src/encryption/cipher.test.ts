import { describe, expect, test } from "vitest";

import { createCipher } from "./cipher";

const textEncoder = new TextEncoder();

async function importAesGcmKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(material), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

describe("createCipher", () => {
	test("round-trips bytes with AES-256-GCM", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const data = textEncoder.encode("hello world");
		const additionalData = textEncoder.encode("key-a");

		const encrypted = await cipher.encrypt({ key, data, additionalData });
		const decrypted = await cipher.decrypt({ key, encrypted, additionalData });
		expect(decrypted).toEqual(data);
	});

	test("round-trips empty data", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const data = new Uint8Array(0);
		const additionalData = textEncoder.encode("key-a");

		const encrypted = await cipher.encrypt({ key, data, additionalData });
		const decrypted = await cipher.decrypt({ key, encrypted, additionalData });
		expect(decrypted).toEqual(data);
	});

	test("rejects decrypt under different additionalData", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const encrypted = await cipher.encrypt({
			key,
			data: textEncoder.encode("secret"),
			additionalData: textEncoder.encode("key-a"),
		});

		await expect(
			cipher.decrypt({
				key,
				encrypted,
				additionalData: textEncoder.encode("key-b"),
			})
		).rejects.toThrow();
	});

	test("rejects decrypt under a different key", async () => {
		const cipher = createCipher("AES-256-GCM");
		const keyA = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const keyB = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const additionalData = textEncoder.encode("key-a");
		const encrypted = await cipher.encrypt({
			key: keyA,
			data: textEncoder.encode("secret"),
			additionalData,
		});

		await expect(cipher.decrypt({ key: keyB, encrypted, additionalData })).rejects.toThrow();
	});

	test("rejects encrypted data shorter than IV plus authentication tag", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const additionalData = textEncoder.encode("key-a");

		await expect(
			cipher.decrypt({
				key,
				encrypted: new Uint8Array(0),
				additionalData,
			})
		).rejects.toThrow("Encrypted data must be at least 28 bytes, got 0");
		// 27 bytes is IV (12) + short of a 16-byte tag; must not reach WebCrypto.
		await expect(
			cipher.decrypt({
				key,
				encrypted: new Uint8Array(27),
				additionalData,
			})
		).rejects.toThrow("Encrypted data must be at least 28 bytes, got 27");
	});
});
