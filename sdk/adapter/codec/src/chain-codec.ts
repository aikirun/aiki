import type { Codec, CodecContext } from "@aikirun/types/infra/codec";

import { InvalidCodecPayloadFormatError, isEncodedPayload, type NamedCreateCodec } from "./codec";

export class UnknownChainedCodecNameError extends Error {
	public readonly codecName: string;
	public readonly knownCodecNames: string[];

	constructor(codecName: string, knownCodecNames: string[]) {
		super(`No chained codec named "${codecName}"; known: ${knownCodecNames.map((name) => `"${name}"`).join(", ")}`);
		this.name = `UnknownChainedCodecNameError(${codecName})`;
		this.codecName = codecName;
		this.knownCodecNames = knownCodecNames;
	}
}

export class DuplicateChainedCodecNameError extends Error {
	public readonly codecName: string;

	constructor(codecName: string) {
		super(`Chained codecs must have unique names; "${codecName}" appears more than once`);
		this.name = `DuplicateChainedCodecNameError(${codecName})`;
		this.codecName = codecName;
	}
}

/**
 * Encodes with the new codec. On decode, reads the stored `codecName` and runs only the
 * member that wrote that value.
 * Throws `DuplicateChainedCodecNameError` if the codecs have the same name.
 */
export function chainCodecs(newCodec: NamedCreateCodec, oldCodec: NamedCreateCodec): NamedCreateCodec {
	if (newCodec.codecName === oldCodec.codecName) {
		throw new DuplicateChainedCodecNameError(newCodec.codecName);
	}

	return Object.assign(
		(context: CodecContext): Codec => {
			const newInstance = newCodec(context);
			const oldInstance = oldCodec(context);

			return {
				encode: (payload) => newInstance.encode(payload),
				decode: async (payload) => {
					if (!isEncodedPayload(payload)) {
						throw new InvalidCodecPayloadFormatError(newCodec.codecName);
					}

					if (payload.codecName === newCodec.codecName) {
						return newInstance.decode(payload);
					}

					if (payload.codecName === oldCodec.codecName) {
						return oldInstance.decode(payload);
					}

					throw new UnknownChainedCodecNameError(payload.codecName, [newCodec.codecName, oldCodec.codecName]);
				},
			};
		},
		{ codecName: newCodec.codecName }
	);
}
