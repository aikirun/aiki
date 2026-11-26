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
	DefinitionCodecMissingError,
	type WorkflowRunId,
} from "@aikirun/types/workflow/run";

export interface OpaquePayloadCodec {
	encode(payload: unknown): Promise<OpaquePayload>;
	decode(payload: OpaquePayload | undefined): Promise<unknown>;
}

/**
 * A codec composed from an optional definition layer and an optional client layer.
 * `definitionCodecSupplied` is true when the definition layer was present at compose time.
 */
export interface ComposedCodec extends OpaquePayloadCodec {
	definitionCodecSupplied: boolean;
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
 * Encodes through `definition` then `client`. Decodes through `client` then `definition`. Absent
 * layers are skipped; the result is wrapped once. `definitionCodecSupplied` tracks whether
 * `definition` was present.
 */
export function composeCodecs(
	definition: Codec<unknown> | undefined,
	client: Codec<unknown> | undefined
): ComposedCodec {
	const definitionCodecSupplied = definition !== undefined;

	if (definition && client) {
		return {
			...toOpaquePayloadCodec({
				encode: async (payload) => client.encode(await definition.encode(payload)),
				decode: async (encoded) => definition.decode(await client.decode(encoded)),
			}),
			definitionCodecSupplied,
		};
	}

	if (definition) {
		return {
			...toOpaquePayloadCodec(definition),
			definitionCodecSupplied,
		};
	}

	if (client) {
		return {
			...toOpaquePayloadCodec(client),
			definitionCodecSupplied,
		};
	}

	return {
		...noopCodec,
		definitionCodecSupplied,
	};
}

/**
 * Composes the definition input codec with the client codec chosen by policy.
 * `clientCodecApplied` reflects only the client layer; `definitionInputCodecApplied` only the definition.
 */
export function resolveWorkflowInputCodec(params: {
	definitionCodec: Codec<unknown> | undefined;
	clientCodec: Codec<unknown> | undefined;
	policy: ClientCodecPolicy | undefined;
}): { codec: ComposedCodec; clientCodecApplied: boolean; definitionInputCodecApplied: boolean } {
	const clientCodecApplied = params.policy !== "skip" && params.clientCodec !== undefined;
	const codec = composeCodecs(params.definitionCodec, clientCodecApplied ? params.clientCodec : undefined);

	return {
		codec,
		clientCodecApplied,
		definitionInputCodecApplied: codec.definitionCodecSupplied,
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

/**
 * Returns the definition codec when a stored record declares it was applied, undefined otherwise.
 * Throws when the record expects a definition codec that is absent.
 */
export function resolveDeclaredDefinitionCodec(
	definitionCodec: Codec<unknown> | undefined,
	declaration: { runId: WorkflowRunId; definitionCodecApplied: boolean }
): Codec<unknown> | undefined {
	if (!declaration.definitionCodecApplied) {
		return undefined;
	}

	if (!definitionCodec) {
		throw new DefinitionCodecMissingError(declaration.runId);
	}

	return definitionCodec;
}
