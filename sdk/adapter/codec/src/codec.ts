import type { Codec, CreateCodec } from "@aikirun/types/infra/codec";

export type CodecOptions = {
	name: string;
	encode: (payload: unknown) => unknown | Promise<unknown>;
	decode: (namedEncodedPayload: unknown) => unknown | Promise<unknown>;
};

export type NamedCreateCodec = CreateCodec & {
	readonly codecName: string;
};

export class InvalidCodecPayloadFormatError extends Error {
	public readonly codecName: string;

	constructor(codecName: string) {
		super(`Codec "${codecName}" payload is missing the { codecName, body } envelope`);
		this.name = `InvalidCodecPayloadFormatError(${codecName})`;
		this.codecName = codecName;
	}
}

export class CodecNameMismatchError extends Error {
	public readonly codecName: string;
	public readonly payloadName: string;

	constructor(codecName: string, payloadName: string) {
		super(`Codec name mismatch: expected "${codecName}", got "${payloadName}"`);
		this.name = `CodecNameMismatchError(${codecName})`;
		this.codecName = codecName;
		this.payloadName = payloadName;
	}
}

export type NamedEncodedPayload = {
	codecName: string;
	body: unknown;
};

export function isEncodedPayload(payload: unknown): payload is NamedEncodedPayload {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"codecName" in payload &&
		"body" in payload &&
		typeof (payload as NamedEncodedPayload).codecName === "string"
	);
}

export function codec({ name, encode, decode }: CodecOptions): NamedCreateCodec {
	const create: NamedCreateCodec = Object.assign(
		(): Codec => ({
			encode: async (payload) => {
				const body = encode(payload);
				return {
					codecName: name,
					body: body instanceof Promise ? await body : body,
				};
			},
			decode: async (payload) => {
				if (!isEncodedPayload(payload)) {
					throw new InvalidCodecPayloadFormatError(name);
				}

				if (payload.codecName !== name) {
					throw new CodecNameMismatchError(name, payload.codecName);
				}

				const decoded = decode(payload.body);

				return decoded instanceof Promise ? await decoded : decoded;
			},
		}),
		{ codecName: name }
	);

	return create;
}
