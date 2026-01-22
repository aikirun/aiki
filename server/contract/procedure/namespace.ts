import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type { NamespaceApi, NamespaceCreateRequestV1, NamespaceCreateResponseV1 } from "@aikirun/types/namespace-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";

export type { NamespaceApi, NamespaceInfo } from "@aikirun/types/namespace-api";

const createV1: ContractProcedure<NamespaceCreateRequestV1, NamespaceCreateResponseV1> = oc
	.input(type({ name: "string > 0" }))
	.output(
		type({
			namespace: {
				id: "string",
				name: "string",
				organizationId: "string",
				createdAt: "number > 0",
			},
		})
	);

export const namespaceContract = { createV1 };

export type NamespaceContract = typeof namespaceContract;

export type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<NamespaceContract>, NamespaceApi>>;
