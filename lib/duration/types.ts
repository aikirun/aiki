import type { RequireAtLeastOneOf } from "../object/types.ts";

type DurationMs = number;

export interface DurationFields {
	days?: number;
	hours?: number;
	minutes?: number;
	seconds?: number;
	ms?: number;
}

export type DurationObject = RequireAtLeastOneOf<DurationFields, keyof DurationFields>;

export type Duration = DurationMs | DurationObject;
