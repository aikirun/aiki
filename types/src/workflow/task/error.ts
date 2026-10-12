import type { TaskId } from "./task";

export class TaskFailedError extends Error {
	public override readonly name = "TaskFailedError";
	public readonly taskId: TaskId;
	public readonly attempts: number;
	public readonly reason: string;

	constructor(taskId: TaskId, attempts: number, reason: string) {
		super(`Task ${taskId} failed after ${attempts} attempts. Reason: ${reason}`);
		this.taskId = taskId;
		this.attempts = attempts;
		this.reason = reason;
	}
}
