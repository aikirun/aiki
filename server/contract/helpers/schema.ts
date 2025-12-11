import type { z } from "zod";

export type Zt<Input, Output = Input> = z.ZodType<Input, Output>;
