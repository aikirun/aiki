import type { Logger } from "@aikirun/lib/logger";

export interface CodecContext {
	logger: Logger;
}

/**
 * Transforms a payload before Aiki stores it, and back when Aiki reads it.
 * `Encoded` is what `encode` returns; it is stored as JSON.
 */
export type Codec<Encoded> = {
	encode(payload: unknown): Promise<Encoded>;
	decode(encoded: unknown): Promise<unknown>;
};

export type CreateCodec<Encoded> = (context: CodecContext) => Codec<Encoded>;
