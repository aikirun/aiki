import type { Client } from "@aikirun/types/client";
import type { Codec } from "@aikirun/types/infra/codec";
import type { OpaquePayload } from "@aikirun/types/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { ClientCodecMissingError, type WorkflowRunId, type WorkflowRunRecord } from "@aikirun/types/workflow/run";

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

export function bindRunCodec<Context>(client: Client<Context>, run: WorkflowRunRecord): BoundCodec {
	if (!run.clientCodecApplied) {
		return noopCodec;
	}

	const codec = client[INTERNAL].codec;
	if (!codec) {
		throw new ClientCodecMissingError(run.id as WorkflowRunId);
	}

	return toBoundCodec(codec);
}
