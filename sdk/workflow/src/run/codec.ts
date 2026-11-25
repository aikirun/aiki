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

export interface OpaquePayloadCodec {
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

export const noopCodec: OpaquePayloadCodec = {
	encode: async (payload) => payload as OpaquePayload,
	decode: async (encoded) => encoded,
};

/**
 * A codec can throw anything, so its errors are wrapped in `CodecEncodeFailedError` and
 * `CodecDecodeFailedError` for the SDK to recognise, with the codec's error as the cause.
 */
export const toOpaquePayloadCodec = (codec: Codec<unknown>): OpaquePayloadCodec => ({
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
 * skipped; the result is wrapped once.
 */
export function composeCodecs(
	inner: Codec<unknown> | undefined,
	outer: Codec<unknown> | undefined
): OpaquePayloadCodec {
	if (inner && outer) {
		return toOpaquePayloadCodec({
			encode: async (payload) => outer.encode(await inner.encode(payload)),
			decode: async (encoded) => inner.decode(await outer.decode(encoded)),
		});
	}

	if (inner) {
		return toOpaquePayloadCodec(inner);
	}

	if (outer) {
		return toOpaquePayloadCodec(outer);
	}

	return noopCodec;
}

/**
 * Composes the definition input codec (inner) with the client codec (outer) chosen by policy.
 * `clientCodecApplied` reflects only the client layer.
 */
export function resolveWorkflowInputCodec(params: {
	definitionCodec: Codec<unknown> | undefined;
	clientCodec: Codec<unknown> | undefined;
	policy: ClientCodecPolicy | undefined;
}): { codec: OpaquePayloadCodec; clientCodecApplied: boolean } {
	const clientCodecApplied = params.policy !== "skip" && params.clientCodec !== undefined;

	return {
		codec: composeCodecs(params.definitionCodec, clientCodecApplied ? params.clientCodec : undefined),
		clientCodecApplied,
	};
}

/**
 * Returns the client's codec when the stored payload says it was applied, undefined otherwise.
 * Throws when the payload expects a codec the client lacks.
 */
export function resolveAppliedClientCodec<Context>(
	client: Client<Context>,
	params: { runId: WorkflowRunId; clientCodecApplied: boolean }
): Codec<unknown> | undefined {
	if (!params.clientCodecApplied) {
		return undefined;
	}

	const codec = client[INTERNAL].codec;
	if (!codec) {
		throw new ClientCodecMissingError(params.runId);
	}

	return codec;
}
