import type { RequireAtLeastOneProp } from "./utils";

export interface DurationFields {
	days?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

export type DurationObject = RequireAtLeastOneProp<DurationFields>;

type DurationMs = number;

export type Duration = DurationMs | DurationObject;
