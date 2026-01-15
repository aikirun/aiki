import type { Schedule, ScheduleSpec, ScheduleStatus } from "./schedule";

export interface ScheduleApi {
	registerV1: (_: ScheduleRegisterRequestV1) => Promise<ScheduleRegisterResponseV1>;
	getByIdV1: (_: ScheduleGetByIdRequestV1) => Promise<ScheduleGetByIdResponseV1>;
	getByNameV1: (_: ScheduleGetByNameRequestV1) => Promise<ScheduleGetByNameResponseV1>;
	listV1: (_: ScheduleListRequestV1) => Promise<ScheduleListResponseV1>;
	pauseV1: (_: SchedulePauseRequestV1) => Promise<SchedulePauseResponseV1>;
	resumeV1: (_: ScheduleResumeRequestV1) => Promise<ScheduleResumeResponseV1>;
	deleteV1: (_: ScheduleDeleteRequestV1) => Promise<void>;
}

export interface ScheduleRegisterRequestV1 {
	name: string;
	workflowName: string;
	workflowVersionId: string;
	input?: unknown;
	spec: ScheduleSpec;
}

export interface ScheduleRegisterResponseV1 {
	schedule: Schedule;
}

export interface ScheduleGetByIdRequestV1 {
	id: string;
}

export interface ScheduleGetByIdResponseV1 {
	schedule: Schedule;
}

export interface ScheduleGetByNameRequestV1 {
	name: string;
	workflowName: string;
	workflowVersionId: string;
}

export interface ScheduleGetByNameResponseV1 {
	schedule: Schedule;
}

export interface ScheduleListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		status?: ScheduleStatus[];
	};
}

export interface ScheduleListResponseV1 {
	schedules: Schedule[];
	total: number;
}

export interface SchedulePauseRequestV1 {
	id: string;
}

export interface SchedulePauseResponseV1 {
	schedule: Schedule;
}

export interface ScheduleResumeRequestV1 {
	id: string;
}

export interface ScheduleResumeResponseV1 {
	schedule: Schedule;
}

export interface ScheduleDeleteRequestV1 {
	id: string;
}
