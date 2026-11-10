import { type AsyncLruCache, createAsyncLruCache } from "@aikirun/lib/cache";
import {
	asConfigProvider,
	type ConfigProvider,
	type CreatePassiveConfigProvider,
	type PassiveConfigProviderContext,
} from "@aikirun/lib/config";
import { createCipher } from "@aikirun/lib/crypto";
import { stableStringify } from "@aikirun/lib/json";
import type { CodecContext } from "@aikirun/types/infra/codec";
import type { BoundHasher, CreateHasher, Hash, Hasher } from "@aikirun/types/infra/hasher";

import { base64ToBytes, bytesToBase64, bytesToBase64Url } from "./encoding";
import {
	deriveAesGcmKey,
	deriveHmacKey,
	EncryptionKeyNotFoundError,
	importHkdfKey,
	type ResolveEncryptionKey,
	requireKeyMaterial,
} from "./key-material";
import { codec, type EncodedValue, type NamedCreateCodec } from "../codec";

type PlaintextEnvelope = { input: unknown };

export type EncryptedValue = {
	keyId: string;
	ciphertext: string;
};

export interface EncryptionConfig {
	keyId: string;
	nextKeyId?: string;
	previousKeyIds?: string[];
}

export type EncryptionKeyCacheConfig = {
	maxEntries?: number;
	ttlMs?: number;
};

type DerivedKeys = { aesKey: CryptoKey; hmacKey: CryptoKey };

const AES_256_GCM_CIPHER = createCipher("AES-256-GCM");
const HASH_KEY_ID_SEPARATOR = ":";
const DEFAULT_KEY_CACHE_MAX_ENTRIES = 64;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isPlaintextEnvelope(value: unknown): value is PlaintextEnvelope {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	// JSON.stringify({ input: undefined }) yields {} because undefined values are omitted.
	return keys.length === 0 || (keys.length === 1 && keys[0] === "input");
}

function encodePayload(payload: unknown): Uint8Array<ArrayBuffer> {
	const envelope: PlaintextEnvelope = { input: payload };

	return textEncoder.encode(JSON.stringify(envelope));
}

function decodePayload(bytes: Uint8Array): unknown {
	const parsed: unknown = JSON.parse(textDecoder.decode(bytes));

	if (!isPlaintextEnvelope(parsed)) {
		throw new Error("Encrypted plaintext is not { input: unknown }");
	}

	return parsed.input;
}

function encodeCiphertext(encrypted: Uint8Array): string {
	return bytesToBase64(encrypted);
}

function decodeCiphertext(ciphertext: string): Uint8Array {
	let bytes: Uint8Array;
	try {
		bytes = base64ToBytes(ciphertext);
	} catch {
		throw new Error("Ciphertext is not valid standard base64");
	}

	// Decoders may accept non-canonical forms; require an exact standard-base64 spelling.
	if (bytesToBase64(bytes) !== ciphertext) {
		throw new Error("Ciphertext is not canonical standard base64");
	}

	return bytes;
}

function toDerivedKeyCache(keyCache: false | EncryptionKeyCacheConfig | undefined): AsyncLruCache<DerivedKeys> {
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

function additionalDataFor(keyId: string): Uint8Array {
	return textEncoder.encode(keyId);
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

function formatHash(keyId: string, digest: Uint8Array): string {
	return `${keyId}${HASH_KEY_ID_SEPARATOR}${bytesToBase64Url(digest)}`;
}

function parseHashKeyId(hash: string): string | null {
	// Real-world KMS identifiers frequently contain colons (e.g. AWS ARNs), so split on the last separator.
	const separatorIndex = hash.lastIndexOf(HASH_KEY_ID_SEPARATOR);
	if (separatorIndex <= 0 || separatorIndex === hash.length - 1) {
		return null;
	}
	return hash.slice(0, separatorIndex);
}

export interface EncryptionParams {
	name: string;

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

/**
 * Builds an AES-256-GCM codec and a matching keyed hasher. Each stored value and hash names the
 * `keyId` that produced it; `key` must resolve that id to the same 32-byte master material every
 * time — never overwrite or rotate bytes under an existing id. AES-GCM and HMAC-SHA-256 keys are
 * derived from that material with HKDF-SHA-256 under distinct info labels, so the same bytes are
 * never used as raw key material for both primitives.
 *
 * To rotate, announce the new id in `nextKeyId`, flip it into `keyId` (the old id moves to
 * `previousKeyIds`), then drop the old id from the config once no stored hash uses it. Old values
 * keep decoding because each names its key id, and a run keeps the key its hash was made under for
 * as long as it lives — unless history is later rewritten and re-encoded. The resolver must keep
 * serving every key id a stored value or hash still names.
 * Mutating key material in place leaves ciphertext undecryptable and hashes unverifiable.
 */
export function encryption(params: EncryptionParams): {
	codec: NamedCreateCodec<EncodedValue<EncryptedValue>>;
	hasher: CreateHasher;
} {
	const { name, key: resolveKey, keyCache: keyCacheConfig } = params;
	const derivedKeyCache = toDerivedKeyCache(keyCacheConfig);
	const derivedKeysFor = (keyId: string) =>
		derivedKeyCache.getOrCreate(keyId, async () => {
			const material = await requireKeyMaterial(resolveKey, keyId);
			const hkdfKey = await importHkdfKey(material);
			return { aesKey: await deriveAesGcmKey(hkdfKey), hmacKey: await deriveHmacKey(hkdfKey) };
		});

	const createCodec: NamedCreateCodec<EncodedValue<EncryptedValue>> = Object.assign(
		(context: CodecContext) => {
			const configProvider = toConfigProvider(params.config, context);

			return codec({
				name,
				encode: async (payload) => {
					const { keyId } = configProvider.config;
					const { aesKey } = await derivedKeysFor(keyId);
					const encrypted = await AES_256_GCM_CIPHER.encrypt({
						key: aesKey,
						data: encodePayload(payload),
						additionalData: additionalDataFor(keyId),
					});

					return {
						keyId,
						ciphertext: encodeCiphertext(encrypted),
					};
				},
				decode: async (encoded) => {
					if (!isEncryptedBody(encoded)) {
						throw new EncryptionDecryptFailedError({
							message: "Encrypted body does not fit { keyId, ciphertext }",
						});
					}

					const { keyId, ciphertext } = encoded;
					const { aesKey } = await derivedKeysFor(keyId);

					try {
						const decrypted = await AES_256_GCM_CIPHER.decrypt({
							key: aesKey,
							encrypted: decodeCiphertext(ciphertext),
							additionalData: additionalDataFor(keyId),
						});

						return decodePayload(decrypted);
					} catch (err) {
						throw new EncryptionDecryptFailedError({ keyId, cause: err });
					}
				},
			})(context);
		},
		{ codecName: name }
	);

	const createHasher: CreateHasher = (context) => {
		const configProvider = toConfigProvider(params.config, context);

		const signWithHmacKey = async (input: unknown, keyId: string, hmacKey: CryptoKey): Promise<string> => {
			const digest = new Uint8Array(
				await crypto.subtle.sign("HMAC", hmacKey, textEncoder.encode(stableStringify({ input })))
			);

			return formatHash(keyId, digest);
		};

		const hashUnderKey = async (input: unknown, keyId: string): Promise<string> => {
			const { hmacKey } = await derivedKeysFor(keyId);
			return signWithHmacKey(input, keyId, hmacKey);
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

					try {
						const { hmacKey } = await derivedKeysFor(keyId);

						return async (input: unknown) => signWithHmacKey(input, keyId, hmacKey);
					} catch (err) {
						if (err instanceof EncryptionKeyNotFoundError && err.keyId === keyId) {
							return null;
						}

						throw err;
					}
				},
			}
		) satisfies Hasher;

		return hasher;
	};

	return { codec: createCodec, hasher: createHasher };
}
