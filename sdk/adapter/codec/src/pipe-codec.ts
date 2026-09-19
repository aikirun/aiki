import type { Codec, CodecContext } from "@aikirun/types/infra/codec";

import type { NamedCreateCodec } from "./codec";

/**
 * Encodes through each codec in order. Decodes in reverse order.
 * Example: `pipeCodecs(compress, encrypt, offloadToS3)`.
 */
export function pipeCodecs(first: NamedCreateCodec, ...rest: NamedCreateCodec[]): NamedCreateCodec {
	const members = [first, ...rest];
	const outermost = rest.at(-1) ?? first;

	return Object.assign(
		(context: CodecContext): Codec => {
			const instances = members.map((create) => create(context));

			return {
				encode: async (payload) => {
					let encoded: unknown = payload;
					for (const instance of instances) {
						encoded = await instance.encode(encoded);
					}
					return encoded;
				},
				decode: async (payload) => {
					let decoded: unknown = payload;
					for (const instance of instances.slice().reverse()) {
						decoded = await instance.decode(decoded);
					}
					return decoded;
				},
			};
		},
		{ codecName: outermost.codecName }
	);
}
