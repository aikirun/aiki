import type { SerializableError } from "./serializable.ts";

export type TaskRunResultNone = {
	state: "none";
};

export type TaskRunResultCompleted<Output> = {
	state: "completed";
	output: Output;
};

export type TaskRunResultFailed = {
	state: "failed";
	reason: string;
	attempts: number;
	attemptedAt: number;
	nextAttemptAt?: number;
	error?: SerializableError;
};

export type TaskRunResult<Output> =
	| TaskRunResultNone
	| TaskRunResultCompleted<Output>
	| TaskRunResultFailed;
