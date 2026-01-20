import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type {
	WorkflowApi,
	WorkflowGetStatsRequestV1,
	WorkflowGetStatsResponseV1,
	WorkflowListRequestV1,
	WorkflowListResponseV1,
	WorkflowListVersionsRequestV1,
	WorkflowListVersionsResponseV1,
} from "@aikirun/types/workflow-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";

const getStatsV1: ContractProcedure<WorkflowGetStatsRequestV1, WorkflowGetStatsResponseV1> = oc
	.input(
		type({
			"name?": "string > 0 | undefined",
			"versionId?": "string > 0 | undefined",
		})
	)
	.output(
		type({
			stats: {
				totalRuns: "number.integer >= 0",
				runsByStatus: {
					scheduled: "number.integer >= 0",
					queued: "number.integer >= 0",
					running: "number.integer >= 0",
					paused: "number.integer >= 0",
					sleeping: "number.integer >= 0",
					awaiting_event: "number.integer >= 0",
					awaiting_retry: "number.integer >= 0",
					awaiting_child_workflow: "number.integer >= 0",
					cancelled: "number.integer >= 0",
					completed: "number.integer >= 0",
					failed: "number.integer >= 0",
				},
			},
		})
	);

const listV1: ContractProcedure<WorkflowListRequestV1, WorkflowListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"sort?": {
				field: "'name' | 'runCount' | 'lastRunAt'",
				order: "'asc' | 'desc'",
			},
		})
	)
	.output(
		type({
			workflows: type({
				name: "string > 0",
				runCount: "number.integer >= 0",
				lastRunAt: "number > 0 | null",
			}).array(),
			total: "number.integer >= 0",
		})
	);

const listVersionsV1: ContractProcedure<WorkflowListVersionsRequestV1, WorkflowListVersionsResponseV1> = oc
	.input(
		type({
			name: "string > 0",
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"sort?": {
				field: "'firstSeenAt' | 'runCount'",
				order: "'asc' | 'desc'",
			},
		})
	)
	.output(
		type({
			versions: type({
				versionId: "string > 0",
				firstSeenAt: "number > 0",
				lastRunAt: "number > 0 | null",
				runCount: "number.integer >= 0",
			}).array(),
			total: "number.integer >= 0",
		})
	);

export const workflowContract = {
	getStatsV1,
	listV1,
	listVersionsV1,
};

export type WorkflowContract = typeof workflowContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<WorkflowContract>, WorkflowApi>>;
