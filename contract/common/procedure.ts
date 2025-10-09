import type { ContractProcedure as ORPCContractProcedure, Schema } from "@orpc/contract";

export type ContractProcedure<I, O> = ORPCContractProcedure<
	Schema<I, unknown>,
	Schema<unknown, O>,
	Record<never, never>,
	Record<never, never>
>;
