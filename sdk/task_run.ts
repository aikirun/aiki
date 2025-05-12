export type TaskRunResult<Result> = 
	| {
		state: "none"
	}
	| {
		state: "completed";
		result: Result;
	}
	| {
		state: "failed";
		reason: string;
	};
