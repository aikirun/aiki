import { InvalidStableTextError, stableText } from "./stable-text";

const AES_GCM_IV_BYTE_LENGTH = 12;
const AES_GCM_TAG_BYTE_LENGTH = 16;
const AES_GCM_TAG_BIT_LENGTH = AES_GCM_TAG_BYTE_LENGTH * 8;
const AES_GCM_MIN_PACKED_BYTE_LENGTH = AES_GCM_IV_BYTE_LENGTH + AES_GCM_TAG_BYTE_LENGTH;
const textEncoder = new TextEncoder();

export const ENCRYPTION_ALGORITHMS = ["AES-256-GCM"] as const;
export type EncryptionAlgorithm = (typeof ENCRYPTION_ALGORITHMS)[number];

export class InvalidEncryptedValueError extends Error {
	public override readonly name = "InvalidEncryptedValueError";

	constructor() {
		super("Encrypted value is not { keyId: string, ciphertext: string }");
	}
}

export class UnsupportedEncryptionAlgorithmError extends Error {
	public override readonly name = "UnsupportedEncryptionAlgorithmError";
	public readonly algorithm: string;

	constructor(algorithm: string) {
		super(`Unsupported encryption algorithm "${algorithm}"`);
		this.algorithm = algorithm;
	}
}

function additionalDataFor(algorithm: EncryptionAlgorithm, keyId: string): Uint8Array {
	return textEncoder.encode(`${algorithm}:${keyId}`);
}

function aesGcmParams(iv: Uint8Array, additionalData: Uint8Array) {
	return {
		name: "AES-GCM" as const,
		iv,
		additionalData,
		tagLength: AES_GCM_TAG_BIT_LENGTH,
	};
}

async function importAesGcmKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(material), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function decodePackedCiphertext(ciphertext: string): Uint8Array {
	const packed = Buffer.from(ciphertext, "base64");
	// Buffer.from ignores non-alphabet characters; require an exact standard-base64 spelling.
	if (packed.toString("base64") !== ciphertext) {
		throw new InvalidEncryptedValueError();
	}
	if (packed.byteLength < AES_GCM_MIN_PACKED_BYTE_LENGTH) {
		throw new InvalidEncryptedValueError();
	}
	return new Uint8Array(packed);
}

async function encryptAes256Gcm(
	payload: unknown,
	key: CryptoKey,
	algorithm: EncryptionAlgorithm,
	keyId: string
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTE_LENGTH));
	const plaintext = stableText.encode(payload);
	const encrypted = new Uint8Array(
		await crypto.subtle.encrypt(aesGcmParams(iv, additionalDataFor(algorithm, keyId)), key, plaintext)
	);
	const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
	packed.set(iv, 0);
	packed.set(encrypted, iv.byteLength);

	return Buffer.from(packed).toString("base64");
}

async function decryptAes256Gcm(
	ciphertext: string,
	key: CryptoKey,
	algorithm: EncryptionAlgorithm,
	keyId: string
): Promise<unknown> {
	const packed = decodePackedCiphertext(ciphertext);
	const iv = new Uint8Array(packed.subarray(0, AES_GCM_IV_BYTE_LENGTH));
	const encrypted = new Uint8Array(packed.subarray(AES_GCM_IV_BYTE_LENGTH));
	const plaintext = await crypto.subtle.decrypt(aesGcmParams(iv, additionalDataFor(algorithm, keyId)), key, encrypted);

	try {
		return stableText.decode(plaintext);
	} catch (err) {
		if (err instanceof InvalidStableTextError) {
			throw new InvalidEncryptedValueError();
		}
		throw err;
	}
}

export interface Cipher {
	importKey(material: Uint8Array): Promise<CryptoKey>;
	encrypt(payload: unknown, key: CryptoKey, keyId: string): Promise<string>;
	decrypt(ciphertext: string, key: CryptoKey, keyId: string): Promise<unknown>;
}

export function createCipher(algorithm: EncryptionAlgorithm): Cipher {
	switch (algorithm) {
		case "AES-256-GCM":
			return {
				importKey: importAesGcmKey,
				encrypt: (payload, key, keyId) => encryptAes256Gcm(payload, key, algorithm, keyId),
				decrypt: (ciphertext, key, keyId) => decryptAes256Gcm(ciphertext, key, algorithm, keyId),
			};
		default:
			throw new UnsupportedEncryptionAlgorithmError(algorithm satisfies never);
	}
}
