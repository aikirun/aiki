import type { z } from "zod";
import type { ContractProcedureBuilderWithInputOutput } from "@orpc/contract";

export type Contract<I, O> = ContractProcedureBuilderWithInputOutput<
	z.ZodType<I>,
	z.ZodType<O>,
	Record<never, never>,
	Record<never, never>
>;
