import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	WorkflowApi,
	WorkflowListRequestV1,
	WorkflowListResponseV1,
	WorkflowListVersionsRequestV1,
	WorkflowListVersionsResponseV1,
} from "@aikirun/types/api/workflow";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import { workflowSourceSchema } from "../schema/workflow";

const listV1: ContractProcedure<WorkflowListRequestV1, WorkflowListResponseV1> = oc
	.input(
		type({
			source: workflowSourceSchema,
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"namePrefix?": "string > 0 | undefined",
		})
	)
	.output(
		type({
			workflows: type({
				name: "string > 0",
				source: workflowSourceSchema,
			}).array(),
			total: "number.integer >= 0",
		})
	);

const listVersionsV1: ContractProcedure<WorkflowListVersionsRequestV1, WorkflowListVersionsResponseV1> = oc
	.input(
		type({
			name: "string > 0",
			source: workflowSourceSchema,
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
		})
	)
	.output(
		type({
			versions: type({
				versionId: "string > 0",
			}).array(),
			total: "number.integer >= 0",
		})
	);

export const workflowContract = {
	listV1,
	listVersionsV1,
};

export type WorkflowContract = typeof workflowContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowContract>, WorkflowApi>>;
