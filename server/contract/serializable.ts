import type { SerializableError } from "@aikirun/lib/error";
import { z } from "zod";

import type { Zt } from "./helpers/schema";

export const serializedErrorSchema: Zt<SerializableError> = z.object({
	message: z.string(),
	name: z.string(),
	stack: z.string().optional(),
	cause: z.lazy(() => serializedErrorSchema).optional(),
});
