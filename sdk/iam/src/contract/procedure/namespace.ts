import { oc } from "@orpc/contract";
import { type } from "arktype";

import { namespaceInfoSchema, namespaceMemberInfoSchema, namespaceMemberInputSchema } from "../schema/namespace";

const createV1 = oc.input(type({ name: "string > 0" })).output(type({ namespace: namespaceInfoSchema }));

const listV1 = oc.input(type("undefined")).output(type({ namespaces: namespaceInfoSchema.array() }));

const deleteV1 = oc.input(type({ id: "string > 0" })).output(type("undefined"));

const listForUserV1 = oc
	.input(type({ userId: "string > 0" }))
	.output(type({ namespaces: namespaceInfoSchema.array() }));

const setMembershipV1 = oc
	.input(
		type({
			id: "string > 0",
			members: namespaceMemberInputSchema.array(),
		})
	)
	.output(type("undefined"));

const removeMembershipV1 = oc.input(type({ id: "string > 0", userId: "string > 0" })).output(type("undefined"));

const listMembersV1 = oc.input(type({ id: "string > 0" })).output(type({ members: namespaceMemberInfoSchema.array() }));

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
