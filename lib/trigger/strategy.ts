export type TriggerStrategy =
	| { type: "immediate" }
	| { type: "delayed"; delayMs: number }
	| { type: "startAt"; startAt: Date };
