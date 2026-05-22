import { createHash } from "node:crypto";

import { stableStringify } from "../json";

export function sha256Sync(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export async function sha256(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashInput(input: unknown): Promise<string> {
	return sha256(stableStringify({ input }));
}
