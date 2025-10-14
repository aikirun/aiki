export class TaskFailedError extends Error {
	constructor(
		public readonly taskName: string,
		public readonly attempts: number,
		public readonly reason: string,
	) {
		super(`Task "${taskName}" failed after ${attempts} attempts. Reason: ${reason}`);
		this.name = "TaskFailedError";
	}
}
