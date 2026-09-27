import type { Codec, CreateCodec } from "@aikirun/types/infra/codec";

export type CodecParams = {
	name: string;
	encode: (payload: unknown) => unknown | Promise<unknown>;
	decode: (encoded: unknown) => unknown | Promise<unknown>;
};

export type NamedCreateCodec = CreateCodec & {
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

export type EncodedValue = {
	codecName: string;
	body: unknown;
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

export function codec({ name, encode, decode }: CodecParams): NamedCreateCodec {
	const create: NamedCreateCodec = Object.assign(
		(): Codec => ({
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

				if (encoded.codecName !== name) {
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
