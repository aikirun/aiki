import type { OpaquePayload } from "@aikirun/types/payload";
import { type } from "arktype";

export const opaquePayloadSchema = type("unknown").as<OpaquePayload>();
