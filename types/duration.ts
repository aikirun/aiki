import type { RequireAtLeastOneOf } from "./utils";

export interface DurationFields {
	days?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

export type DurationObject = RequireAtLeastOneOf<DurationFields, keyof DurationFields>;

type DurationMs = number;

export type Duration = DurationMs | DurationObject;
