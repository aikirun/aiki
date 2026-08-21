import { noopCodec } from "@aikirun/codec";
import type { Codec } from "@aikirun/types/infra/codec";
import type { WorkflowSource } from "@aikirun/types/workflow";
import type { ClientCodec } from "@aikirun/types/workflow/run";

/**
 * System workflows should not use the client codec — always fall back to noop.
 */
export function configureCodec(source: WorkflowSource, clientCodec: ClientCodec, codec: Codec): Codec {
	return source !== "system" && clientCodec === "applied" ? codec : noopCodec;
}
