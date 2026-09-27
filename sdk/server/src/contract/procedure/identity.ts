import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type { IdentityApi, IdentityGetRequestV1, IdentityGetResponseV1 } from "@aikirun/types/api/identity";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";

const getV1: ContractProcedure<IdentityGetRequestV1, IdentityGetResponseV1> = oc.input(type({ "+": "reject" })).output(
	type({
		organizationId: type("string > 0"),
		namespaceId: type("string > 0"),
	})
);

export const identityContract = { getV1 };

export type IdentityContract = typeof identityContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<IdentityContract>, IdentityApi>>;
