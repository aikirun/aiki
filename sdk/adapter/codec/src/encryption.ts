import { type AsyncLruCache, createAsyncLruCache } from "@aikirun/lib/cache";
import {
	asConfigProvider,
	type ConfigProvider,
	type CreatePassiveConfigProvider,
	type PassiveConfigProviderContext,
} from "@aikirun/lib/config";
import { createCipher, type EncryptionAlgorithm, EncryptionDecryptFailedError, stableText } from "@aikirun/lib/crypto";
import type { CodecContext } from "@aikirun/types/infra/codec";
import type { BoundHasher, CreateHasher, Hash, Hasher } from "@aikirun/types/infra/hasher";

import { codec, type EncodedValue, type NamedCreateCodec } from "./codec";

const AES_256_KEY_BYTE_LENGTH = 32;
const HASH_KEY_ID_SEPARATOR = ":";
const DEFAULT_KEY_CACHE_MAX_ENTRIES = 64;
const textEncoder = new TextEncoder();
const AES_256_GCM_HKDF_INFO = textEncoder.encode("aiki:codec:AES-256-GCM");
const HMAC_SHA_256_HKDF_INFO = textEncoder.encode("aiki:hasher:HMAC-SHA-256");
const HKDF_SALT = new Uint8Array();

export type EncryptedValue = {
	keyId: string;
	ciphertext: string;
};

export interface EncryptionConfig {
	keyId: string;
	nextKeyId?: string;
	previousKeyIds?: string[];
}

export type ResolveEncryptionKey = (keyId: string) => Uint8Array | null | Promise<Uint8Array | null>;

export type EncryptionKeyCacheConfig = {
	maxEntries?: number;
	ttlMs?: number;
};

export interface EncryptionParams {
	algorithm: EncryptionAlgorithm;

	/**
	 * Resolves master key material for a `keyId`. Resolvers must return `null` for unknown ids
	 * (do not throw); that throws {@link EncryptionKeyNotFoundError}, so the run is left for
	 * redelivery. Deploy new keys to every worker's resolver (and list them in `previousKeyIds` /
	 * the key store as needed) before any producer activates that `keyId` for encoding.
	 */
	key: ResolveEncryptionKey;

	config: EncryptionConfig | CreatePassiveConfigProvider<EncryptionConfig>;

	/**
	 * Derived CryptoKey cache shared across all codec and hasher contexts from this
	 * `encryption()` call. Pass `false` to re-resolve and re-derive on every use.
	 * Default: enabled with 64 entries and no TTL.
	 */
	keyCache?: false | EncryptionKeyCacheConfig;
}

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

function isEncryptedBody(value: unknown): value is EncryptedValue {
	return (
		typeof value === "object" &&
		value !== null &&
		"keyId" in value &&
		"ciphertext" in value &&
		typeof (value as EncryptedValue).keyId === "string" &&
		(value as EncryptedValue).keyId.length > 0 &&
		typeof (value as EncryptedValue).ciphertext === "string"
	);
}

function toConfigProvider(
	config: EncryptionConfig | CreatePassiveConfigProvider<EncryptionConfig>,
	context: PassiveConfigProviderContext
): ConfigProvider<EncryptionConfig> {
	if (typeof config === "function") {
		return config(context);
	}
	return asConfigProvider(() => config);
}

async function resolveKeyMaterial(resolveKey: ResolveEncryptionKey, keyId: string): Promise<Uint8Array | null> {
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

async function requireKeyMaterial(resolveKey: ResolveEncryptionKey, keyId: string): Promise<Uint8Array> {
	const material = await resolveKeyMaterial(resolveKey, keyId);
	if (material === null) {
		throw new EncryptionKeyNotFoundError(keyId);
	}
	return material;
}

async function importHkdfKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(material), "HKDF", false, ["deriveKey"]);
}

async function deriveAesGcmKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: AES_256_GCM_HKDF_INFO },
		await importHkdfKey(material),
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

async function deriveHmacKey(material: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HMAC_SHA_256_HKDF_INFO },
		await importHkdfKey(material),
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		false,
		["sign"]
	);
}

function formatHash(keyId: string, digest: Uint8Array): string {
	return `${keyId}${HASH_KEY_ID_SEPARATOR}${Buffer.from(digest).toString("base64url")}`;
}

function parseHashKeyId(hash: string): string | null {
	// Real-world KMS identifiers frequently contain colons (e.g. AWS ARNs), so split on the last separator.
	const separatorIndex = hash.lastIndexOf(HASH_KEY_ID_SEPARATOR);
	if (separatorIndex <= 0 || separatorIndex === hash.length - 1) {
		return null;
	}
	return hash.slice(0, separatorIndex);
}

function toDerivedKeyCache(keyCache: false | EncryptionKeyCacheConfig | undefined): AsyncLruCache<CryptoKey> {
	if (keyCache === false) {
		return {
			getOrCreate(_keyId, create) {
				return create();
			},
		};
	}

	return createAsyncLruCache({
		maxEntries: keyCache?.maxEntries ?? DEFAULT_KEY_CACHE_MAX_ENTRIES,
		ttlMs: keyCache?.ttlMs ?? null,
	});
}

/**
 * Builds a codec for selected `EncryptionAlgorithm` and a matching keyed hasher. Each stored value and hash names the
 * `keyId` that produced it; `key` must resolve that id to the same 32-byte master material every
 * time — never overwrite or rotate bytes under an existing id. AES-GCM and HMAC-SHA-256 keys are
 * derived from that material with HKDF-SHA-256 under distinct info labels, so the same bytes are
 * never used as raw key material for both primitives.
 *
 * To rotate, announce the new id in `nextKeyId`, flip it into `keyId` (the old id moves to
 * `previousKeyIds`), then drop the old id from the config once no stored hash uses it. Old values
 * keep decoding because each names its key id, and a run keeps the key its hash was made under for
 * as long as it lives — unless history is later rewritten and re-encoded. The resolver must keep
 * serving every key id a stored value or hash still names. Mutating material in place leaves
 * ciphertext undecryptable and hashes unverifiable.
 */
export function encryption(params: EncryptionParams): {
	codec: NamedCreateCodec<EncodedValue<EncryptedValue>>;
	hasher: CreateHasher;
} {
	const { algorithm, key: resolveKey, keyCache: keyCacheConfig } = params;
	const cipher = createCipher(algorithm);
	// Per encryption() instance, not per context: contexts are often short-lived (per run / handle).
	const aesKeys = toDerivedKeyCache(keyCacheConfig);
	const hmacKeys = toDerivedKeyCache(keyCacheConfig);

	const createCodec: NamedCreateCodec<EncodedValue<EncryptedValue>> = Object.assign(
		(context: CodecContext) => {
			const configProvider = toConfigProvider(params.config, context);

			const aesKeyFor = async (keyId: string): Promise<CryptoKey> => {
				return aesKeys.getOrCreate(keyId, async () => {
					const material = await requireKeyMaterial(resolveKey, keyId);

					return deriveAesGcmKey(material);
				});
			};

			return codec({
				name: algorithm,
				encode: async (payload) => {
					const { keyId } = configProvider.config;
					const key = await aesKeyFor(keyId);
					const ciphertext = await cipher.encrypt(payload, key, keyId);

					return { keyId, ciphertext };
				},
				decode: async (encoded) => {
					if (!isEncryptedBody(encoded)) {
						throw new EncryptionDecryptFailedError({
							message: "Encrypted body does not fit { keyId, ciphertext }",
						});
					}

					const key = await aesKeyFor(encoded.keyId);
					return await cipher.decrypt(encoded.ciphertext, key, encoded.keyId);
				},
			})(context);
		},
		{ codecName: algorithm }
	);

	const createHasher: CreateHasher = (context) => {
		const configProvider = toConfigProvider(params.config, context);

		const resolveHmacKey = async (keyId: string): Promise<CryptoKey | null> => {
			try {
				return await hmacKeys.getOrCreate(keyId, async () => {
					const material = await resolveKeyMaterial(resolveKey, keyId);
					if (material === null) {
						throw new EncryptionKeyNotFoundError(keyId);
					}
					return deriveHmacKey(material);
				});
			} catch (err) {
				if (err instanceof EncryptionKeyNotFoundError && err.keyId === keyId) {
					return null;
				}
				throw err;
			}
		};

		const hmacKeyFor = async (keyId: string): Promise<CryptoKey> => {
			const cryptoKey = await resolveHmacKey(keyId);

			if (cryptoKey === null) {
				throw new EncryptionKeyNotFoundError(keyId);
			}

			return cryptoKey;
		};

		const signWithHmacKey = async (input: unknown, keyId: string, cryptoKey: CryptoKey): Promise<string> => {
			const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, stableText.encode(input)));

			return formatHash(keyId, digest);
		};

		const hashUnderKey = async (input: unknown, keyId: string): Promise<string> => {
			return signWithHmacKey(input, keyId, await hmacKeyFor(keyId));
		};

		const hasher = Object.assign(
			async (input: unknown): Promise<Hash> => {
				const config = configProvider.config;
				const value = await hashUnderKey(input, config.keyId);

				const hash: Hash = { value };

				if (config.previousKeyIds !== undefined && config.previousKeyIds.length > 0) {
					hash.deprecatedValues = await Promise.all(
						config.previousKeyIds.map((previousKeyId) => hashUnderKey(input, previousKeyId))
					);
				}

				if (config.nextKeyId !== undefined) {
					hash.nextValue = await hashUnderKey(input, config.nextKeyId);
				}

				return hash;
			},
			{
				for: async (hash: string): Promise<BoundHasher | null> => {
					const keyId = parseHashKeyId(hash);
					if (keyId === null) {
						return null;
					}

					const cryptoKey = await resolveHmacKey(keyId);
					if (cryptoKey === null) {
						return null;
					}

					return async (input: unknown) => signWithHmacKey(input, keyId, cryptoKey);
				},
			}
		) satisfies Hasher;

		return hasher;
	};

	return { codec: createCodec, hasher: createHasher };
}
