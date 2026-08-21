import type { Codec, EncodedPayload } from "@aikirun/types/infra/codec";

export const noopCodec: Codec = {
	encode: async (payload: unknown): Promise<EncodedPayload> => ({ encodedValue: payload }),
	decode: async (payload: EncodedPayload): Promise<unknown> => payload.encodedValue,
};
