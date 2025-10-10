import type { ContractProcedure as ORPCContractProcedure, Schema } from "@orpc/contract";

export type ContractProcedure<I, O> = ORPCContractProcedure<
	Schema<I, I>,
	Schema<O, O>,
	Record<never, never>,
	Record<never, never>
>;
