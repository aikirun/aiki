const AES_256_KEY_BYTE_LENGTH = 32;
const textEncoder = new TextEncoder();
const AES_256_GCM_HKDF_INFO = textEncoder.encode("aiki:codec:AES-256-GCM");
const HMAC_SHA_256_HKDF_INFO = textEncoder.encode("aiki:hasher:HMAC-SHA-256");
const HKDF_SALT = new Uint8Array();

export type ResolveEncryptionKey = (keyId: string) => Uint8Array | null | Promise<Uint8Array | null>;

export class EncryptionKeyNotFoundError extends Error {
	public override readonly name = "EncryptionKeyNotFoundError";
	public readonly keyId: string;

	constructor(keyId: string) {
		super(`Encryption key "${keyId}" was not found`);
		this.keyId = keyId;
	}
}

export class InvalidEncryptionKeyError extends Error {
	public override readonly name = "InvalidEncryptionKeyError";
	public readonly keyId: string;
	public readonly byteLength: number;

	constructor(keyId: string, byteLength: number) {
		super(`Encryption key "${keyId}" must be ${AES_256_KEY_BYTE_LENGTH} bytes, got ${byteLength}`);
		this.keyId = keyId;
		this.byteLength = byteLength;
	}
}

export async function resolveKeyMaterial(resolveKey: ResolveEncryptionKey, keyId: string): Promise<Uint8Array | null> {
	if (keyId.length === 0) {
		return null;
	}

	const result = resolveKey(keyId);
	const material = result instanceof Promise ? await result : result;

	if (material === null) {
		return null;
	}

	if (material.byteLength !== AES_256_KEY_BYTE_LENGTH) {
		throw new InvalidEncryptionKeyError(keyId, material.byteLength);
	}

	return material;
}

export async function requireKeyMaterial(resolveKey: ResolveEncryptionKey, keyId: string): Promise<Uint8Array> {
	const material = await resolveKeyMaterial(resolveKey, keyId);
	if (material === null) {
		throw new EncryptionKeyNotFoundError(keyId);
	}
	return material;
}

export async function importHkdfKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(material), "HKDF", false, ["deriveKey"]);
}

export async function deriveAesGcmKey(hkdfKey: CryptoKey): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: AES_256_GCM_HKDF_INFO },
		hkdfKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

export async function deriveHmacKey(hkdfKey: CryptoKey): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HMAC_SHA_256_HKDF_INFO },
		hkdfKey,
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		false,
		["sign"]
	);
}
