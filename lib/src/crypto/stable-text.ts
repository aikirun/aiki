import { stableStringify } from "../json";

type StableTextEnvelope = { input: unknown };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class InvalidStableTextError extends Error {
	public override readonly name = "InvalidStableTextError";

	constructor() {
		super("Stable text is not { input: unknown }");
	}
}

function isStableTextEnvelope(value: unknown): value is StableTextEnvelope {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	// encode(undefined) yields {} because stableStringify omits undefined values.
	return keys.length === 0 || (keys.length === 1 && keys[0] === "input");
}

function encode(input: unknown): Uint8Array<ArrayBuffer> {
	const envelope: StableTextEnvelope = { input };

	return encoder.encode(stableStringify(envelope));
}

function decode(bytes: BufferSource): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoder.decode(bytes));
	} catch {
		throw new InvalidStableTextError();
	}

	if (!isStableTextEnvelope(parsed)) {
		throw new InvalidStableTextError();
	}

	return parsed.input;
}

export const stableText = { encode, decode };
