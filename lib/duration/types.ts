import type { RequireAtLeastOneOf } from "../object/types";

type DurationMs = number;

export interface DurationFields {
	days?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

export type DurationObject = RequireAtLeastOneOf<DurationFields, keyof DurationFields>;

export type Duration = DurationMs | DurationObject;
