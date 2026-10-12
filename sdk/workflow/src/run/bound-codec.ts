import type { Client } from "@aikirun/types/client";
import type { Codec } from "@aikirun/types/infra/codec";
import type { OpaquePayload } from "@aikirun/types/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { ClientCodecMissingError, type ClientCodecPolicy, type WorkflowRunId } from "@aikirun/types/workflow/run";

export interface BoundCodec {
	encode(payload: unknown): Promise<OpaquePayload>;
	decode(payload: OpaquePayload | undefined): Promise<unknown>;
}

export const noopCodec: BoundCodec = {
	encode: async (payload) => payload as OpaquePayload,
	decode: async (encoded) => encoded,
};

export const toBoundCodec = (codec: Codec<unknown>): BoundCodec => ({
	encode: async (payload) => (await codec.encode(payload)) as OpaquePayload,
	decode: (encoded) => codec.decode(encoded),
});

/**
 * Picks the codec a start should use from the client's codec and the run's policy. `"skip"` (or no
 * client codec) yields the noop and `applied: false`; otherwise the client codec and `applied: true`.
 */
export function resolveClientCodec(
	clientCodec: Codec<unknown> | undefined,
	policy: ClientCodecPolicy | undefined
): { codec: BoundCodec; applied: boolean } {
	if (policy === "skip" || clientCodec === undefined) {
		return { codec: noopCodec, applied: false };
	}

	return { codec: toBoundCodec(clientCodec), applied: true };
}

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
