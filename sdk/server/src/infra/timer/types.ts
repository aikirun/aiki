import type { TimerType } from "@aikirun/types/infra/timer";

export interface Timer {
	type: TimerType;
	id: string;
	dueAt: number;
	priority: number | undefined;
}
