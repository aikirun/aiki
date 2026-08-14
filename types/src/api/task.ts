import type { TaskRecord } from "../workflow/task";

export interface TaskApi {
	getByIdV1: (_: TaskGetByIdRequestV1) => Promise<TaskGetByIdResponseV1>;
}

export interface TaskGetByIdRequestV1 {
	id: string;
}

export interface TaskGetByIdResponseV1 {
	task: TaskRecord;
}
