import type { Serializable } from "@aikirun/lib/serializable";
import type { Codec, CreateCodec } from "@aikirun/types/infra/codec";

export type CodecParams<Encoded> = {
	name: string;
	encode: (payload: unknown) => Encoded | Promise<Encoded>;
	decode: (encoded: Encoded) => unknown | Promise<unknown>;
};

export type NamedCreateCodec<Encoded = unknown> = CreateCodec<Encoded> & {
	readonly codecName: string;
};

export class InvalidEncodedValueError extends Error {
	public readonly codecName: string;

	constructor(codecName: string) {
		super(`Codec "${codecName}" received a value that was not produced by encode`);
		this.name = "InvalidEncodedValueError";
		this.codecName = codecName;
	}
}

export class CodecNameMismatchError extends Error {
	public readonly codecName: string;
	public readonly payloadName: string;

	constructor(codecName: string, payloadName: string) {
		super(`Codec name mismatch: expected "${codecName}", got "${payloadName}"`);
		this.name = "CodecNameMismatchError";
		this.codecName = codecName;
		this.payloadName = payloadName;
	}
}

export type EncodedValue<Body = unknown> = {
	codecName: string;
	body: Body;
};

export function isEncodedValue(payload: unknown): payload is EncodedValue {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"codecName" in payload &&
		"body" in payload &&
		typeof (payload as EncodedValue).codecName === "string"
	);
}

/** A value carrying this codec's name was written by its `encode`, so its body has that codec's `Encoded` type. */
function isWrittenBy<Encoded>(encoded: EncodedValue, codecName: string): encoded is EncodedValue<Encoded> {
	return encoded.codecName === codecName;
}

export function codec<Encoded = never>({
	name,
	encode,
	decode,
}: CodecParams<Encoded> & Serializable<Encoded, "encoded">): NamedCreateCodec<EncodedValue<Encoded>> {
	const create: NamedCreateCodec<EncodedValue<Encoded>> = Object.assign(
		(): Codec<EncodedValue<Encoded>> => ({
			encode: async (payload) => {
				const body = encode(payload);
				return {
					codecName: name,
					body: body instanceof Promise ? await body : body,
				};
			},
			decode: async (encoded) => {
				if (!isEncodedValue(encoded)) {
					throw new InvalidEncodedValueError(name);
				}

				if (!isWrittenBy<Encoded>(encoded, name)) {
					throw new CodecNameMismatchError(name, encoded.codecName);
				}

				const decoded = decode(encoded.body);

				return decoded instanceof Promise ? await decoded : decoded;
			},
		}),
		{ codecName: name }
	);

	return create;
}
