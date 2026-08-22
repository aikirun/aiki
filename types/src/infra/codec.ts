import type { Logger } from "@aikirun/lib/logger";

export interface CodecContext {
	logger: Logger;
}

export interface EncodedPayload {
	encodedValue: unknown;
}

export type Codec = {
	encode(payload: unknown): Promise<EncodedPayload>;
	decode(payload: EncodedPayload): Promise<unknown>;
};

export type CreateCodec = (context: CodecContext) => Codec;
