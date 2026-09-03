import type { Logger } from "@aikirun/lib/logger";

export interface CodecContext {
	logger: Logger;
}

export type Codec = {
	encode(payload: unknown): Promise<unknown>;
	decode(payload: unknown): Promise<unknown>;
};

export type CreateCodec = (context: CodecContext) => Codec;
