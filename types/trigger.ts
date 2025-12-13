import type { DurationObject } from "./duration";

export type TriggerStrategy =
	| { type: "immediate" }
	| { type: "delayed"; delayMs: number }
	| { type: "delayed"; delay: DurationObject }
	| { type: "startAt"; startAt: number };
