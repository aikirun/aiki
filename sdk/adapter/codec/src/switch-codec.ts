import type { Codec, CodecContext } from "@aikirun/types/infra/codec";

import { InvalidEncodedValueError, isEncodedValue, type NamedCreateCodec } from "./codec";

export class UnknownCodecNameError extends Error {
	public readonly codecName: string;
	public readonly knownCodecNames: string[];

	constructor(codecName: string, knownCodecNames: string[]) {
		super(`No codec named "${codecName}"; known: ${knownCodecNames.map((name) => `"${name}"`).join(", ")}`);
		this.name = "UnknownCodecNameError";
		this.codecName = codecName;
		this.knownCodecNames = knownCodecNames;
	}
}

export class DuplicateCodecNameError extends Error {
	public readonly codecName: string;

	constructor(codecName: string) {
		super(`Codec names must be unique; "${codecName}" appears more than once`);
		this.name = "DuplicateCodecNameError";
		this.codecName = codecName;
	}
}

export interface SwitchCodecsParams<Encoded> {
	current: NamedCreateCodec<Encoded>;
	deprecated: NamedCreateCodec[];
}

/**
 * Encodes with the current codec. On decode, reads the stored `codecName`(s) and runs only the
 * member that wrote that value.
 * Throws `DuplicateCodecNameError` if any codecs share a name.
 * Throws `UnknownCodecNameError` on decode when the payload's `codecName` matches no
 * member.
 */
export function switchCodecs<Encoded>({ current, deprecated }: SwitchCodecsParams<Encoded>): NamedCreateCodec<Encoded> {
	const members = [current, ...deprecated];
	const seenNames = new Set<string>();
	for (const member of members) {
		if (seenNames.has(member.codecName)) {
			throw new DuplicateCodecNameError(member.codecName);
		}
		seenNames.add(member.codecName);
	}
	const knownCodecNames = members.map((member) => member.codecName);

	return Object.assign(
		(context: CodecContext): Codec<Encoded> => {
			const currentInstance = current(context);
			const instancesByName = new Map<string, Codec<unknown>>([
				[current.codecName, currentInstance],
				...deprecated.map((member) => [member.codecName, member(context)] as const),
			]);

			return {
				encode: (payload) => currentInstance.encode(payload),
				decode: async (encoded) => {
					if (!isEncodedValue(encoded)) {
						throw new InvalidEncodedValueError(current.codecName);
					}

					const instance = instancesByName.get(encoded.codecName);
					if (instance === undefined) {
						throw new UnknownCodecNameError(encoded.codecName, knownCodecNames);
					}

					return instance.decode(encoded);
				},
			};
		},
		{ codecName: current.codecName }
	);
}
