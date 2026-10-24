import type { Logger } from "@aikirun/lib/logger";
import type { Client } from "@aikirun/types/client";
import type { Codec, CreateCodec } from "@aikirun/types/infra/codec";
import type { OpaquePayload } from "@aikirun/types/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	ClientCodecMissingError,
	type ClientCodecPolicy,
	CodecDecodeFailedError,
	CodecEncodeFailedError,
	CodecInitFailedError,
	type WorkflowRunId,
} from "@aikirun/types/workflow/run";

export interface BoundCodec {
	encode(payload: unknown): Promise<OpaquePayload>;
	decode(payload: OpaquePayload | undefined): Promise<unknown>;
}

export type WorkflowDefinitionCodec = {
	input?: Codec<unknown>;
	output?: Codec<unknown>;
};

export type CreateWorkflowDefinitionCodec<EncodedInput = unknown, EncodedOutput = unknown> = {
	input?: CreateCodec<EncodedInput>;
	output?: CreateCodec<EncodedOutput>;
};

/**
 * Instantiates definition codecs from their factories. A factory can throw anything, so its
 * errors are wrapped in `CodecInitFailedError` for the SDK to recognise, with the factory's
 * error as the cause.
 */
export function instantiateWorkflowDefinitionCodec(
	create: CreateWorkflowDefinitionCodec | undefined,
	logger: Logger
): WorkflowDefinitionCodec | undefined {
	if (!create) {
		return undefined;
	}

	const codec: WorkflowDefinitionCodec = {};
	if (create.input) {
		try {
			codec.input = create.input({ logger });
		} catch (err) {
			throw new CodecInitFailedError(err);
		}
	}

	if (create.output) {
		try {
			codec.output = create.output({ logger });
		} catch (err) {
			throw new CodecInitFailedError(err);
		}
	}

	if (!codec.input && !codec.output) {
		return undefined;
	}

	return codec;
}

export const noopCodec: BoundCodec = {
	encode: async (payload) => payload as OpaquePayload,
	decode: async (encoded) => encoded,
};

/**
 * A codec can throw anything, so its errors are wrapped in `CodecEncodeFailedError` and
 * `CodecDecodeFailedError` for the SDK to recognise, with the codec's error as the cause.
 */
export const toBoundCodec = (codec: Codec<unknown>): BoundCodec => ({
	encode: async (payload) => {
		try {
			return (await codec.encode(payload)) as OpaquePayload;
		} catch (err) {
			throw new CodecEncodeFailedError(err);
		}
	},
	decode: async (encoded) => {
		try {
			return await codec.decode(encoded);
		} catch (err) {
			throw new CodecDecodeFailedError(err);
		}
	},
});

/**
 * Encodes through `inner` then `outer`. Decodes through `outer` then `inner`.
 */
export function composeCodecs(inner: BoundCodec, outer: BoundCodec): BoundCodec {
	return {
		encode: async (payload) => outer.encode(await inner.encode(payload)),
		decode: async (encoded) => inner.decode((await outer.decode(encoded)) as OpaquePayload | undefined),
	};
}

/**
 * Binds a definition-level codec, or returns the noop when none is set.
 */
export function bindDefinitionCodec(codec: Codec<unknown> | undefined): BoundCodec {
	if (!codec) {
		return noopCodec;
	}

	return toBoundCodec(codec);
}

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
 * Composes the definition input codec (inner) with the client codec chosen by policy (outer).
 * `clientCodecApplied` reflects only the client layer.
 */
export function resolveInputCodec(params: {
	definition: WorkflowDefinitionCodec | undefined;
	clientCodec: Codec<unknown> | undefined;
	policy: ClientCodecPolicy | undefined;
}): { codec: BoundCodec; clientCodecApplied: boolean } {
	const { codec: clientLayer, applied: clientCodecApplied } = resolveClientCodec(params.clientCodec, params.policy);

	return {
		codec: composeCodecs(bindDefinitionCodec(params.definition?.input), clientLayer),
		clientCodecApplied,
	};
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
