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

/**
 * The codec cannot encode or decode this payload, and another worker with the same codec will not
 * succeed either. `details` carries structured facts about the failure (for example a missing
 * `keyId`). In a workflow, a client-codec failure whose cause is this error fails the run at once
 * instead of leaving it for redelivery.
 */
export class CodecPermanentError extends Error {
	public override readonly name: string = "CodecPermanentError";
	public readonly details: Readonly<Record<string, unknown>>;

	constructor(message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
		const errorOptions: ErrorOptions = {};
		if (options?.cause !== undefined) {
			errorOptions.cause = options.cause;
		}
		super(message, errorOptions);
		this.details = details;
	}
}
