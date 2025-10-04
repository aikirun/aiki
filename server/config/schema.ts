import { z } from "zod";

export const environmentSchema = z.enum(["development", "production", "test"]);

export type Environment = z.infer<typeof environmentSchema>;

export const configSchema = z.object({
	port: z.coerce.number().int().positive().default(3000),
	nodeEnv: environmentSchema.default("development"),
});

export type Config = z.infer<typeof configSchema>;
