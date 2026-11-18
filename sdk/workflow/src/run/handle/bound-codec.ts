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

export interface BoundCodec {
	encode(payload: unknown): Promise<OpaquePayload>;
	decode(payload: OpaquePayload | undefined): Promise<unknown>;
}

/**
 * A bound codec composed from an optional definition layer and an optional client layer.
 * `definitionCodecSupplied` is true when the definition layer was present at compose time.
 */
export interface ComposedCodec extends BoundCodec {
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
 * Encodes through `definition` then `client`. Decodes through `client` then `definition`. Absent
 * layers are skipped; the result is bound once. `definitionCodecSupplied` tracks whether
 * `definition` was present.
 */
export function composeCodecs(
	definition: Codec<unknown> | undefined,
	client: Codec<unknown> | undefined
): ComposedCodec {
	const definitionCodecSupplied = definition !== undefined;

	if (definition && client) {
		return {
			...toBoundCodec({
				encode: async (payload) => client.encode(await definition.encode(payload)),
				decode: async (encoded) => definition.decode(await client.decode(encoded)),
			}),
			definitionCodecSupplied,
		};
	}

	if (definition) {
		return {
			...toBoundCodec(definition),
			definitionCodecSupplied,
		};
	}

	if (client) {
		return {
			...toBoundCodec(client),
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
 * `clientCodecApplied` reflects only the client layer; `definitionCodecApplied` only the definition.
 */
export function resolveWorkflowInputCodec(params: {
	definitionCodec: Codec<unknown> | undefined;
	clientCodec: Codec<unknown> | undefined;
	policy: ClientCodecPolicy | undefined;
}): { codec: ComposedCodec; clientCodecApplied: boolean; definitionCodecApplied: boolean } {
	const clientCodecApplied = params.policy !== "skip" && params.clientCodec !== undefined;
	const codec = composeCodecs(params.definitionCodec, clientCodecApplied ? params.clientCodec : undefined);

	return {
		codec,
		clientCodecApplied,
		definitionCodecApplied: codec.definitionCodecSupplied,
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
