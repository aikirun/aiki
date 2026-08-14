import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import type { TaskApi, TaskGetByIdRequestV1, TaskGetByIdResponseV1 } from "@aikirun/types/api/task";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure, ContractProcedureToApi } from "./helper";
import { taskRecordSchema } from "../schema/task";

const getByIdV1: ContractProcedure<TaskGetByIdRequestV1, TaskGetByIdResponseV1> = oc
	.input(
		type({
			id: "string > 0",
		})
	)
	.output(
		type({
			task: taskRecordSchema,
		})
	);

export const taskContract = {
	getByIdV1,
};

export type TaskContract = typeof taskContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<TaskContract>, TaskApi>>;
