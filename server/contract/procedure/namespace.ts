import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	NamespaceApi,
	NamespaceCreateRequestV1,
	NamespaceCreateResponseV1,
	NamespaceDeleteRequestV1,
	NamespaceListResponseV1,
} from "@aikirun/types/namespace-api";
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
				role: "'admin' | 'member' | 'viewer'",
				createdAt: "number > 0",
			},
		})
	);

const listV1: ContractProcedure<void, NamespaceListResponseV1> = oc.input(type("undefined")).output(
	type({
		namespaces: type({
			id: "string",
			name: "string",
			organizationId: "string",
			role: "'admin' | 'member' | 'viewer'",
			createdAt: "number > 0",
		}).array(),
	})
);

const deleteV1: ContractProcedure<NamespaceDeleteRequestV1, void> = oc
	.input(type({ id: "string > 0" }))
	.output(type("undefined"));

export const namespaceContract = { createV1, listV1, deleteV1 };

export type NamespaceContract = typeof namespaceContract;

export type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<NamespaceContract>, NamespaceApi>>;
