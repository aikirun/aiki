import type { Codec, CodecContext } from "@aikirun/types/infra/codec";

import { InvalidCodecPayloadFormatError, isEncodedPayload, type NamedCreateCodec } from "./codec";

export class UnknownCodecNameInPayloadError extends Error {
	public readonly codecName: string;
	public readonly knownCodecNames: string[];

	constructor(codecName: string, knownCodecNames: string[]) {
		super(`No codec named "${codecName}"; known: ${knownCodecNames.map((name) => `"${name}"`).join(", ")}`);
		this.name = `UnknownCodecNameInPayloadError(${codecName})`;
		this.codecName = codecName;
		this.knownCodecNames = knownCodecNames;
	}
}

export class DuplicateRoutedCodecNameError extends Error {
	public readonly codecName: string;

	constructor(codecName: string) {
		super(`Codecs for routing must have unique names; "${codecName}" appears more than once`);
		this.name = `DuplicateRoutedCodecNameError(${codecName})`;
		this.codecName = codecName;
	}
}

export interface RouteCodecsOptions {
	current: NamedCreateCodec;
	deprecated: NamedCreateCodec[];
}

/**
 * Encodes with the current codec. On decode, reads the stored `codecName`(s) and runs only the
 * member that wrote that value.
 * Throws `DuplicateRoutedCodecNameError` if any codecs share a name.
 * Throws `UnknownCodecNameInPayloadError` on decode when the payload's `codecName` matches no
 * member.
 */
export function routeCodecs({ current, deprecated }: RouteCodecsOptions): NamedCreateCodec {
	const members = [current, ...deprecated];
	const seenNames = new Set<string>();
	for (const member of members) {
		if (seenNames.has(member.codecName)) {
			throw new DuplicateRoutedCodecNameError(member.codecName);
		}
		seenNames.add(member.codecName);
	}
	const knownCodecNames = members.map((member) => member.codecName);

	return Object.assign(
		(context: CodecContext): Codec => {
			const currentInstance = current(context);
			const instancesByName = new Map<string, Codec>([
				[current.codecName, currentInstance],
				...deprecated.map((member) => [member.codecName, member(context)] as const),
			]);

			return {
				encode: (payload) => currentInstance.encode(payload),
				decode: async (payload) => {
					if (!isEncodedPayload(payload)) {
						throw new InvalidCodecPayloadFormatError(current.codecName);
					}

					const instance = instancesByName.get(payload.codecName);
					if (instance === undefined) {
						throw new UnknownCodecNameInPayloadError(payload.codecName, knownCodecNames);
					}

					return instance.decode(payload);
				},
			};
		},
		{ codecName: current.codecName }
	);
}
