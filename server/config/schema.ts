import { z } from "zod";

export const configSchema = z.object({
	port: z.coerce.number().int().positive().default(9090),
});

export type Config = z.infer<typeof configSchema>;
