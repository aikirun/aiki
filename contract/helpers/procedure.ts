import type { ContractProcedure as ORPCContractProcedure, Schema } from "@orpc/contract";

export type ContractProcedure<I, O> = ORPCContractProcedure<
	Schema<I, I>,
	Schema<O, O>,
	Record<never, never>,
	Record<never, never>
>;

export type ContractProcedureToApi<C> = {
	[K in keyof C]: C[K] extends ContractProcedure<infer In, infer Out> ? (i: In) => Promise<Out> : never;
};
