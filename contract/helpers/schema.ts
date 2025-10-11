import type { z } from "zod";

export type zT<Input, Output = Input> = z.ZodType<Input, Output>;
