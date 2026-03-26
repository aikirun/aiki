import type { TaskId } from "./task";

export class TaskFailedError extends Error {
	public readonly taskId: TaskId;
	public readonly attempts: number;
	public readonly reason: string;

	constructor(taskId: TaskId, attempts: number, reason: string) {
		super(`Task ${taskId} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
		this.taskId = taskId;
		this.attempts = attempts;
		this.reason = reason;
	}
}
