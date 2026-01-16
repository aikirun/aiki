import type { Schedule, ScheduleActivateOptions, ScheduleSpec, ScheduleStatus } from "./schedule";

export interface ScheduleApi {
	activateV1: (_: ScheduleActivateRequestV1) => Promise<ScheduleActivateResponseV1>;
	getByIdV1: (_: ScheduleGetByIdRequestV1) => Promise<ScheduleGetByIdResponseV1>;
	getByReferenceIdV1: (_: ScheduleGetByReferenceIdRequestV1) => Promise<ScheduleGetByReferenceIdResponseV1>;
	listV1: (_: ScheduleListRequestV1) => Promise<ScheduleListResponseV1>;
	pauseV1: (_: SchedulePauseRequestV1) => Promise<SchedulePauseResponseV1>;
	resumeV1: (_: ScheduleResumeRequestV1) => Promise<ScheduleResumeResponseV1>;
	deleteV1: (_: ScheduleDeleteRequestV1) => Promise<void>;
}

export interface ScheduleActivateRequestV1 {
	name: string;
	workflowName: string;
	workflowVersionId: string;
	input?: unknown;
	spec: ScheduleSpec;
	options?: ScheduleActivateOptions;
}

export interface ScheduleActivateResponseV1 {
	schedule: Schedule;
}

export interface ScheduleGetByIdRequestV1 {
	id: string;
}

export interface ScheduleGetByIdResponseV1 {
	schedule: Schedule;
}

export interface ScheduleGetByReferenceIdRequestV1 {
	referenceId: string;
}

export interface ScheduleGetByReferenceIdResponseV1 {
	schedule: Schedule;
}

export interface ScheduleWorkflowFilter {
	name?: string;
	versionId?: string;
}

export interface ScheduleListRequestV1 {
	limit?: number;
	offset?: number;
	filters?: {
		status?: ScheduleStatus[];
		name?: string;
		referenceId?: string;
		workflows?: ScheduleWorkflowFilter[];
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
