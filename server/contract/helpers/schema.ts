import type { z } from "zod";

export type ZT<Input, Output = Input> = z.ZodType<Input, Output>;
