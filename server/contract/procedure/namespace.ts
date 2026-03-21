import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	NamespaceApi,
	NamespaceCreateRequestV1,
	NamespaceCreateResponseV1,
	NamespaceDeleteRequestV1,
	NamespaceListForUserRequestV1,
	NamespaceListForUserResponseV1,
	NamespaceListMembersRequestV1,
	NamespaceListMembersResponseV1,
	NamespaceListResponseV1,
	NamespaceRemoveMembershipRequestV1,
	NamespaceSetMembershipRequestV1,
} from "@aikirun/types/namespace-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import { namespaceInfoSchema, namespaceMemberInfoSchema, namespaceRoleSchema } from "../schema/namespace";

export type { NamespaceApi, NamespaceInfo } from "@aikirun/types/namespace-api";

const createV1: ContractProcedure<NamespaceCreateRequestV1, NamespaceCreateResponseV1> = oc
	.input(type({ name: "string > 0" }))
	.output(type({ namespace: namespaceInfoSchema }));

const listV1: ContractProcedure<void, NamespaceListResponseV1> = oc
	.input(type("undefined"))
	.output(type({ namespaces: namespaceInfoSchema.array() }));

const deleteV1: ContractProcedure<NamespaceDeleteRequestV1, void> = oc
	.input(type({ id: "string > 0" }))
	.output(type("undefined"));

const listForUserV1: ContractProcedure<NamespaceListForUserRequestV1, NamespaceListForUserResponseV1> = oc
	.input(type({ userId: "string > 0" }))
	.output(type({ namespaces: namespaceInfoSchema.array() }));

const setMembershipV1: ContractProcedure<NamespaceSetMembershipRequestV1, void> = oc
	.input(
		type({
			id: "string > 0",
			members: type({
				userId: "string > 0",
				role: namespaceRoleSchema,
			}).array(),
		})
	)
	.output(type("undefined"));

const removeMembershipV1: ContractProcedure<NamespaceRemoveMembershipRequestV1, void> = oc
	.input(type({ id: "string > 0", userId: "string > 0" }))
	.output(type("undefined"));

const listMembersV1: ContractProcedure<NamespaceListMembersRequestV1, NamespaceListMembersResponseV1> = oc
	.input(type({ id: "string > 0" }))
	.output(type({ members: namespaceMemberInfoSchema.array() }));

export const namespaceContract = {
	createV1,
	listV1,
	deleteV1,
	listForUserV1,
	setMembershipV1,
	removeMembershipV1,
	listMembersV1,
};

export type NamespaceContract = typeof namespaceContract;

export type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<NamespaceContract>, NamespaceApi>>;
