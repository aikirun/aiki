import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	ApiKeyApi,
	ApiKeyCreateRequestV1,
	ApiKeyCreateResponseV1,
	ApiKeyListResponseV1,
	ApiKeyRevokeRequestV1,
} from "@aikirun/types/api-key-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import { apiKeyInfoSchema } from "../schema/api-key";

export type { ApiKeyApi, ApiKeyInfo, ApiKeyStatus } from "@aikirun/types/api-key-api";

const createV1: ContractProcedure<ApiKeyCreateRequestV1, ApiKeyCreateResponseV1> = oc
	.input(type({ name: "string > 0", "expiresAt?": "number > 0 | undefined" }))
	.output(type({ key: "string > 0", info: apiKeyInfoSchema }));

const listV1: ContractProcedure<void, ApiKeyListResponseV1> = oc
	.input(type("undefined"))
	.output(type({ keyInfos: apiKeyInfoSchema.array() }));

const revokeV1: ContractProcedure<ApiKeyRevokeRequestV1, void> = oc
	.input(type({ id: "string > 0" }))
	.output(type("undefined"));

export const apiKeyContract = {
	createV1,
	listV1,
	revokeV1,
};

export type ApiKeyContract = typeof apiKeyContract;

export type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<ApiKeyContract>, ApiKeyApi>>;
