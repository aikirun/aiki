import type { Codec, CodecContext } from "@aikirun/types/infra/codec";

import type { NamedCreateCodec } from "./codec";

/**
 * Encodes through each codec in order. Decodes in reverse order.
 * Example: `pipeCodecs(compress, encrypt, offloadToS3)`.
 * The stored value is whatever the last member writes, so that is the output type it reports.
 */
export function pipeCodecs<Encoded>(only: NamedCreateCodec<Encoded>): NamedCreateCodec<Encoded>;
export function pipeCodecs<Inner extends NamedCreateCodec[], Encoded>(
	first: NamedCreateCodec,
	...rest: [...Inner, NamedCreateCodec<Encoded>]
): NamedCreateCodec<Encoded>;
export function pipeCodecs(first: NamedCreateCodec, ...rest: NamedCreateCodec[]): NamedCreateCodec {
	const members = [first, ...rest];
	const outermost = rest.at(-1) ?? first;

	return Object.assign(
		(context: CodecContext): Codec<unknown> => {
			const instances = members.map((create) => create(context));

			return {
				encode: async (payload) => {
					let encoded: unknown = payload;
					for (const instance of instances) {
						encoded = await instance.encode(encoded);
					}
					return encoded;
				},
				decode: async (encoded) => {
					let decoded: unknown = encoded;
					for (let index = instances.length - 1; index >= 0; index--) {
						const instance = instances[index];
						if (instance === undefined) {
							continue;
						}
						decoded = await instance.decode(decoded);
					}
					return decoded;
				},
			};
		},
		{ codecName: outermost.codecName }
	);
}
