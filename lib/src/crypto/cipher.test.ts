import { describe, expect, test } from "vitest";

import { createCipher, InvalidEncryptedValueError } from "./cipher";

async function importAesGcmKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(material), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

describe("createCipher", () => {
	test("round-trips a payload with AES-256-GCM", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const payload = { name: "alice", count: 3 };

		const ciphertext = await cipher.encrypt(payload, key, "key-a");
		expect(typeof ciphertext).toBe("string");
		expect(await cipher.decrypt(ciphertext, key, "key-a")).toEqual(payload);
	});

	test("rejects decrypt under a different keyId", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const ciphertext = await cipher.encrypt({ n: 1 }, key, "key-a");

		await expect(cipher.decrypt(ciphertext, key, "key-b")).rejects.toThrow();
	});

	test("rejects ciphertext shorter than IV plus authentication tag", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));

		await expect(cipher.decrypt("", key, "key-a")).rejects.toBeInstanceOf(InvalidEncryptedValueError);
		// 27 bytes is IV (12) + short of a 16-byte tag; must not reach WebCrypto.
		await expect(cipher.decrypt(Buffer.alloc(27).toString("base64"), key, "key-a")).rejects.toBeInstanceOf(
			InvalidEncryptedValueError
		);
	});

	test("rejects ciphertext that is not exact standard base64", async () => {
		const cipher = createCipher("AES-256-GCM");
		const key = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
		const ciphertext = await cipher.encrypt({ n: 1 }, key, "key-a");

		await expect(cipher.decrypt(` ${ciphertext}`, key, "key-a")).rejects.toBeInstanceOf(InvalidEncryptedValueError);
		await expect(cipher.decrypt(`${ciphertext}!`, key, "key-a")).rejects.toBeInstanceOf(InvalidEncryptedValueError);
	});
});
