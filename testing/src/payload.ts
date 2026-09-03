import type { OpaquePayload } from "@aikirun/types/payload";

/** Brands a value a test authors as the payload the server stores. */
export function asOpaquePayload(value: unknown): OpaquePayload {
	return value as OpaquePayload;
}
