import type { OpaquePayload } from "@aikirun/types/payload";

export function asOpaquePayload(value: unknown): OpaquePayload {
	return value as OpaquePayload;
}
