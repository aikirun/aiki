import type { ContractProcedure, Schema } from "@orpc/contract";

export type Contract<I, O> = ContractProcedure<
	Schema<I, unknown>,
	Schema<unknown, O>,
	Record<never, never>,
	Record<never, never>
>;