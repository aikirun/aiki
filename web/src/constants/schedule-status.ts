import type { ScheduleStatus } from "@aikirun/types/schedule";

export const SCHEDULE_STATUS_CONFIG: Record<ScheduleStatus, { label: string; className: string; icon: string }> = {
	active: {
		label: "Active",
		className: "bg-emerald-100 text-emerald-700 border-emerald-300",
		icon: "play",
	},
	paused: {
		label: "Paused",
		className: "bg-amber-100 text-amber-700 border-amber-300",
		icon: "pause",
	},
	deleted: {
		label: "Deleted",
		className: "bg-red-100 text-red-700 border-red-300",
		icon: "trash",
	},
};

export type ScheduleStatusOption = { value: ScheduleStatus; label: string };

export const SCHEDULE_STATUS_OPTIONS: ScheduleStatusOption[] = Object.entries(SCHEDULE_STATUS_CONFIG).map(
	([value, { label }]) => ({
		value: value as ScheduleStatus,
		label,
	})
);
