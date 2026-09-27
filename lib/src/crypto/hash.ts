import { createHash } from "node:crypto";

import { stableStringify } from "../json";

/**
 * Fast unsalted hash — for content addressing (input/definition fingerprints)
 * where the input need not be secret. If hashing a secret, it must be
 * high-entropy (e.g. a generated API key); never a user-chosen password —
 * those need a slow KDF (scrypt/Argon2) to compensate for low entropy.
 */
export function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * Fast unsalted hash — for content addressing (input/definition fingerprints)
 * where the input need not be secret. If hashing a secret, it must be
 * high-entropy (e.g. a generated API key); never a user-chosen password —
 * those need a slow KDF (scrypt/Argon2) to compensate for low entropy.
 */
export async function sha256Async(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashInput(input: unknown): Promise<string> {
	return sha256Async(stableStringify({ input }));
}
