export type TaskRunResult<Output> =
	| {
		state: "none";
	}
	| {
		state: "completed";
		output: Output;
	}
	| {
		state: "failed";
		reason: string;
	};
