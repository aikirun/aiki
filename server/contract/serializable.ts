import { z } from "zod";
import type { SerializableError } from "@aiki/types/serializable";
import type { zT } from "./helpers/schema.ts";

export const serializedErrorSchema: zT<SerializableError> = z.object({
	message: z.string(),
	name: z.string(),
	stack: z.string().optional(),
	cause: z.lazy(() => serializedErrorSchema).optional(),
});
