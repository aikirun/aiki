import type { Equal, ExpectTrue } from "@aikirun/lib";
import type {
	ScheduleActivateRequestV1,
	ScheduleActivateResponseV1,
	ScheduleApi,
	ScheduleDeleteRequestV1,
	ScheduleGetByIdRequestV1,
	ScheduleGetByIdResponseV1,
	ScheduleGetByReferenceIdRequestV1,
	ScheduleGetByReferenceIdResponseV1,
	ScheduleListRequestV1,
	ScheduleListResponseV1,
	SchedulePauseRequestV1,
	SchedulePauseResponseV1,
	ScheduleResumeRequestV1,
	ScheduleResumeResponseV1,
} from "@aikirun/types/schedule-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import {
	scheduleActivateOptionsSchema,
	scheduleSchema,
	scheduleSpecSchema,
	scheduleStatusSchema,
	scheduleWorkflowFilterSchema,
} from "./schema";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure";

const activateV1: ContractProcedure<ScheduleActivateRequestV1, ScheduleActivateResponseV1> = oc
	.input(
		type({
			workflowName: "string > 0",
			workflowVersionId: "string > 0",
			"input?": "unknown",
			spec: scheduleSpecSchema,
			"options?": scheduleActivateOptionsSchema.or("undefined"),
		})
	)
	.output(
		type({
			schedule: scheduleSchema,
		})
	);

const getByIdV1: ContractProcedure<ScheduleGetByIdRequestV1, ScheduleGetByIdResponseV1> = oc
	.input(type({ id: "string > 0" }))
	.output(type({ schedule: scheduleSchema }));

const getByReferenceIdV1: ContractProcedure<ScheduleGetByReferenceIdRequestV1, ScheduleGetByReferenceIdResponseV1> = oc
	.input(type({ referenceId: "string > 0" }))
	.output(type({ schedule: scheduleSchema }));

const listV1: ContractProcedure<ScheduleListRequestV1, ScheduleListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"filters?": type({
				"status?": scheduleStatusSchema.array().or("undefined"),
				"id?": "string > 0 | undefined",
				"referenceId?": "string > 0 | undefined",
				"workflows?": scheduleWorkflowFilterSchema.array().or("undefined"),
			}).or("undefined"),
		})
	)
	.output(
		type({
			schedules: scheduleSchema.array(),
			total: "number.integer >= 0",
		})
	);

const pauseV1: ContractProcedure<SchedulePauseRequestV1, SchedulePauseResponseV1> = oc
	.input(type({ id: "string > 0" }))
	.output(type({ schedule: scheduleSchema }));

const resumeV1: ContractProcedure<ScheduleResumeRequestV1, ScheduleResumeResponseV1> = oc
	.input(type({ id: "string > 0" }))
	.output(type({ schedule: scheduleSchema }));

const deleteV1: ContractProcedure<ScheduleDeleteRequestV1, void> = oc
	.input(type({ id: "string > 0" }))
	.output(type("undefined"));

export const scheduleContract = {
	activateV1,
	getByIdV1,
	getByReferenceIdV1,
	listV1,
	pauseV1,
	resumeV1,
	deleteV1,
};

export type ScheduleContract = typeof scheduleContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<ScheduleContract>, ScheduleApi>>;
