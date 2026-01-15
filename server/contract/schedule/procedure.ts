import type { Equal, ExpectTrue } from "@aikirun/lib";
import type {
	ScheduleApi,
	ScheduleDeleteRequestV1,
	ScheduleGetByIdRequestV1,
	ScheduleGetByIdResponseV1,
	ScheduleGetByNameRequestV1,
	ScheduleGetByNameResponseV1,
	ScheduleListRequestV1,
	ScheduleListResponseV1,
	SchedulePauseRequestV1,
	SchedulePauseResponseV1,
	ScheduleRegisterRequestV1,
	ScheduleRegisterResponseV1,
	ScheduleResumeRequestV1,
	ScheduleResumeResponseV1,
} from "@aikirun/types/schedule-api";
import { oc } from "@orpc/contract";
import { type } from "arktype";

import { scheduleSchema, scheduleSpecSchema, scheduleStatusSchema } from "./schema";
import type { ContractProcedure, ContractProcedureToApi } from "../helpers/procedure";

const registerV1: ContractProcedure<ScheduleRegisterRequestV1, ScheduleRegisterResponseV1> = oc
	.input(
		type({
			name: "string > 0",
			workflowName: "string > 0",
			workflowVersionId: "string > 0",
			"input?": "unknown",
			spec: scheduleSpecSchema,
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

const getByNameV1: ContractProcedure<ScheduleGetByNameRequestV1, ScheduleGetByNameResponseV1> = oc
	.input(type({ name: "string > 0", workflowName: "string > 0", workflowVersionId: "string > 0" }))
	.output(type({ schedule: scheduleSchema }));

const listV1: ContractProcedure<ScheduleListRequestV1, ScheduleListResponseV1> = oc
	.input(
		type({
			"limit?": "number.integer > 0 | undefined",
			"offset?": "number.integer >= 0 | undefined",
			"status?": scheduleStatusSchema.or("undefined"),
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
	registerV1,
	getByIdV1,
	getByNameV1,
	listV1,
	pauseV1,
	resumeV1,
	deleteV1,
};

export type ScheduleContract = typeof scheduleContract;

type _ContractSatisfiesApi = ExpectTrue<Equal<ContractProcedureToApi<ScheduleContract>, ScheduleApi>>;
