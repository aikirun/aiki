import type { Logger } from "@aikirun/lib/logger";
import type { RequireAtLeastOneProp } from "@aikirun/lib/object";
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

export type CreateWorkflowDefinitionCodec<EncodedInput = never, EncodedOutput = never> = RequireAtLeastOneProp<{
	input?: CreateCodec<EncodedInput>;
	output?: CreateCodec<EncodedOutput>;
}>;

/**
 * Instantiates a codec from its factory. A factory can throw anything, so its errors are wrapped
 * in `CodecInitFailedError` for the SDK to recognise, with the factory's error as the cause.
 */
export function instantiateCodec(create: CreateCodec<unknown> | undefined, logger: Logger): Codec<unknown> | undefined {
	if (!create) {
		return undefined;
	}

	try {
		return create({ logger });
	} catch (err) {
		throw new CodecInitFailedError(err);
	}
}

/**
 * Instantiates definition codecs from their factories. A factory can throw anything, so its
 * errors are wrapped in `CodecInitFailedError` for the SDK to recognise, with the factory's
 * error as the cause.
 */
export function instantiateWorkflowDefinitionCodec(
	create: CreateWorkflowDefinitionCodec<unknown, unknown> | undefined,
	logger: Logger
): WorkflowDefinitionCodec | undefined {
	if (!create) {
		return undefined;
	}

	const codec: WorkflowDefinitionCodec = {};
	if (create.input) {
		codec.input = instantiateCodec(create.input, logger);
	}
	if (create.output) {
		codec.output = instantiateCodec(create.output, logger);
	}
	return codec;
}

export const noopCodec: BoundCodec = {
	encode: async (payload) => payload as OpaquePayload,
	decode: async (encoded) => encoded,
};

/**
 * A codec can throw anything, so its errors are wrapped in `CodecEncodeFailedError` and
 * `CodecDecodeFailedError` for the SDK to recognise, with the codec's error as the cause. The
 * run is left for redelivery.
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
 * Encodes through `inner` then `outer`. Decodes through `outer` then `inner`. Absent layers are
 * skipped; the result is bound once.
 */
export function composeCodecs(inner: Codec<unknown> | undefined, outer: Codec<unknown> | undefined): BoundCodec {
	if (inner && outer) {
		return toBoundCodec({
			encode: async (payload) => outer.encode(await inner.encode(payload)),
			decode: async (encoded) => inner.decode(await outer.decode(encoded)),
		});
	}

	if (inner) {
		return toBoundCodec(inner);
	}

	if (outer) {
		return toBoundCodec(outer);
	}

	return noopCodec;
}

/**
 * Composes the definition input codec (inner) with the client codec chosen by policy (outer).
 * `clientCodecApplied` reflects only the client layer.
 */
export function resolveWorkflowInputCodec(params: {
	definitionCodec: Codec<unknown> | undefined;
	clientCodec: Codec<unknown> | undefined;
	policy: ClientCodecPolicy | undefined;
}): { codec: BoundCodec; clientCodecApplied: boolean } {
	const clientCodecApplied = params.policy !== "skip" && params.clientCodec !== undefined;

	return {
		codec: composeCodecs(params.definitionCodec, clientCodecApplied ? params.clientCodec : undefined),
		clientCodecApplied,
	};
}

/**
 * Returns the client's codec when a stored record declares it was applied, undefined otherwise.
 * Throws when the record expects a codec the client lacks.
 */
export function resolveDeclaredClientCodec<Context>(
	client: Client<Context>,
	declaration: { runId: WorkflowRunId; clientCodecApplied: boolean }
): Codec<unknown> | undefined {
	if (!declaration.clientCodecApplied) {
		return undefined;
	}

	const codec = client[INTERNAL].codec;
	if (!codec) {
		throw new ClientCodecMissingError(declaration.runId);
	}

	return codec;
}

/**
 * Binds the codec a stored record declares: the client's when the record says the client codec was
 * applied, the noop otherwise. Throws when the record expects a codec the client lacks.
 */
export function bindDeclaredCodec<Context>(
	client: Client<Context>,
	declaration: { runId: WorkflowRunId; clientCodecApplied: boolean }
): BoundCodec {
	const codec = resolveDeclaredClientCodec(client, declaration);
	return codec ? toBoundCodec(codec) : noopCodec;
}
