import { stableText } from "./stable-text";

const AES_GCM_IV_BYTE_LENGTH = 12;
const AES_GCM_TAG_BYTE_LENGTH = 16;
const AES_GCM_TAG_BIT_LENGTH = AES_GCM_TAG_BYTE_LENGTH * 8;
const AES_GCM_MIN_PACKED_BYTE_LENGTH = AES_GCM_IV_BYTE_LENGTH + AES_GCM_TAG_BYTE_LENGTH;
const textEncoder = new TextEncoder();

export const ENCRYPTION_ALGORITHMS = ["AES-256-GCM"] as const;
export type EncryptionAlgorithm = (typeof ENCRYPTION_ALGORITHMS)[number];

export class EncryptionDecryptFailedError extends Error {
	public override readonly name = "EncryptionDecryptFailedError";
	public readonly keyId?: string;

	constructor(options: { keyId?: string; cause?: unknown; message?: string } = {}) {
		const message =
			options.message ??
			(options.cause instanceof Error ? options.cause.message : "Encrypted value could not be decrypted");
		const errorOptions: ErrorOptions = {};

		if ("cause" in options) {
			errorOptions.cause = options.cause;
		}

		super(message, errorOptions);

		if (options.keyId !== undefined) {
			this.keyId = options.keyId;
		}
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

function decodePackedCiphertext(ciphertext: string, keyId: string): Uint8Array {
	const packed = Buffer.from(ciphertext, "base64");
	// Buffer.from ignores non-alphabet characters; require an exact standard-base64 spelling.
	if (packed.toString("base64") !== ciphertext) {
		throw new EncryptionDecryptFailedError({ keyId });
	}
	if (packed.byteLength < AES_GCM_MIN_PACKED_BYTE_LENGTH) {
		throw new EncryptionDecryptFailedError({ keyId });
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
	try {
		const packed = decodePackedCiphertext(ciphertext, keyId);
		const iv = new Uint8Array(packed.subarray(0, AES_GCM_IV_BYTE_LENGTH));
		const encrypted = new Uint8Array(packed.subarray(AES_GCM_IV_BYTE_LENGTH));
		const plaintext = await crypto.subtle.decrypt(
			aesGcmParams(iv, additionalDataFor(algorithm, keyId)),
			key,
			encrypted
		);
		return stableText.decode(plaintext);
	} catch (err) {
		if (err instanceof EncryptionDecryptFailedError) {
			throw err;
		}
		throw new EncryptionDecryptFailedError({ keyId, cause: err });
	}
}

export interface Cipher {
	encrypt(payload: unknown, key: CryptoKey, keyId: string): Promise<string>;
	decrypt(ciphertext: string, key: CryptoKey, keyId: string): Promise<unknown>;
}

export function createCipher(algorithm: EncryptionAlgorithm): Cipher {
	switch (algorithm) {
		case "AES-256-GCM":
			return {
				encrypt: (payload, key, keyId) => encryptAes256Gcm(payload, key, algorithm, keyId),
				decrypt: (ciphertext, key, keyId) => decryptAes256Gcm(ciphertext, key, algorithm, keyId),
			};
		default:
			return algorithm satisfies never;
	}
}
