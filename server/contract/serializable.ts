import { z } from "zod";
import type { SerializableError } from "@aikirun/lib/error";
import type { ZT } from "./helpers/schema.ts";

export const serializedErrorSchema: ZT<SerializableError> = z.object({
	message: z.string(),
	name: z.string(),
	stack: z.string().optional(),
	cause: z.lazy(() => serializedErrorSchema).optional(),
});
