import type { TaskName } from "@aiki/types/task";

export class TaskFailedError extends Error {
	constructor(
		public readonly taskName: TaskName,
		public readonly attempts: number,
		public readonly reason: string,
	) {
		super(`Task ${taskName} failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
	}
}
