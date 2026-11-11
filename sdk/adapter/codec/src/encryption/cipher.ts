const AES_GCM_IV_BYTE_LENGTH = 12;
const AES_GCM_TAG_BYTE_LENGTH = 16;
const AES_GCM_TAG_BIT_LENGTH = AES_GCM_TAG_BYTE_LENGTH * 8;
const AES_GCM_MIN_ENCRYPTED_BYTE_LENGTH = AES_GCM_IV_BYTE_LENGTH + AES_GCM_TAG_BYTE_LENGTH;

export const ENCRYPTION_ALGORITHMS = ["AES-256-GCM"] as const;
export type EncryptionAlgorithm = (typeof ENCRYPTION_ALGORITHMS)[number];

function aesGcmParams(iv: Uint8Array, additionalData: Uint8Array) {
	return {
		name: "AES-GCM" as const,
		iv,
		additionalData,
		tagLength: AES_GCM_TAG_BIT_LENGTH,
	};
}

export async function encryptAesGcm(params: {
	key: CryptoKey;
	data: Uint8Array;
	additionalData: Uint8Array;
}): Promise<Uint8Array> {
	const { key, data, additionalData } = params;
	const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTE_LENGTH));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(aesGcmParams(iv, additionalData), key, new Uint8Array(data))
	);
	const encrypted = new Uint8Array(iv.byteLength + ciphertext.byteLength);
	encrypted.set(iv, 0);
	encrypted.set(ciphertext, iv.byteLength);

	return encrypted;
}

export async function decryptAesGcm(params: {
	key: CryptoKey;
	encrypted: Uint8Array;
	additionalData: Uint8Array;
}): Promise<Uint8Array> {
	const { key, encrypted, additionalData } = params;
	if (encrypted.byteLength < AES_GCM_MIN_ENCRYPTED_BYTE_LENGTH) {
		throw new Error(
			`Encrypted data must be at least ${AES_GCM_MIN_ENCRYPTED_BYTE_LENGTH} bytes, got ${encrypted.byteLength}`
		);
	}

	const iv = new Uint8Array(encrypted.subarray(0, AES_GCM_IV_BYTE_LENGTH));
	const ciphertext = new Uint8Array(encrypted.subarray(AES_GCM_IV_BYTE_LENGTH));
	const decrypted = await crypto.subtle.decrypt(aesGcmParams(iv, additionalData), key, ciphertext);

	return new Uint8Array(decrypted);
}

export interface Cipher {
	encrypt(params: { key: CryptoKey; data: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array>;
	decrypt(params: { key: CryptoKey; encrypted: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array>;
}

export function createCipher(algorithm: EncryptionAlgorithm): Cipher {
	switch (algorithm) {
		case "AES-256-GCM":
			return {
				encrypt: encryptAesGcm,
				decrypt: decryptAesGcm,
			};
		default:
			return algorithm satisfies never;
	}
}
