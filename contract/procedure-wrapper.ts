import type { z } from "zod";
import type { ProcedureBuilderWithInputOutput } from "@orpc/server";

export type ProcedureWrapper<I, O> = ProcedureBuilderWithInputOutput<
	Record<never, never>,
	Record<never, never>,
	z.ZodType<I>,
	z.ZodType<O>,
	Record<never, never>,
	Record<never, never>
>;
