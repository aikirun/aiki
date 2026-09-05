import type { Client } from "@aikirun/types/client";
import type { Codec } from "@aikirun/types/infra/codec";
import type { OpaquePayload } from "@aikirun/types/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { ClientCodecMissingError, type WorkflowRunId } from "@aikirun/types/workflow/run";

export interface BoundCodec {
	encode(payload: unknown): Promise<OpaquePayload>;
	decode(payload: OpaquePayload | undefined): Promise<unknown>;
}

export const noopCodec: BoundCodec = {
	encode: async (payload) => payload as OpaquePayload,
	decode: async (payload) => payload,
};

export const toBoundCodec = (codec: Codec): BoundCodec => ({
	encode: async (payload) => (await codec.encode(payload)) as OpaquePayload,
	decode: (payload) => codec.decode(payload),
});

/**
 * Binds the codec a stored record declares: the client's when the record says the client codec was
 * applied, the noop otherwise. Throws when the record expects a codec the client lacks.
 */
export function bindDeclaredCodec<Context>(
	client: Client<Context>,
	declaration: { runId: WorkflowRunId; clientCodecApplied: boolean }
): BoundCodec {
	if (!declaration.clientCodecApplied) {
		return noopCodec;
	}

	const codec = client[INTERNAL].codec;
	if (!codec) {
		throw new ClientCodecMissingError(declaration.runId);
	}

	return toBoundCodec(codec);
}
