import type { ScheduleStatus } from "@aikirun/types/schedule";

import { SCHEDULE_STATUS_COLORS } from "./status-colors";

export const SCHEDULE_STATUS_CONFIG: Record<ScheduleStatus, { label: string; color: string; glyph: string }> = {
	active: {
		label: "Active",
		color: SCHEDULE_STATUS_COLORS.active,
		glyph: "●",
	},
	paused: {
		label: "Paused",
		color: SCHEDULE_STATUS_COLORS.paused,
		glyph: "❙❙",
	},
	deleted: {
		label: "Deleted",
		color: SCHEDULE_STATUS_COLORS.deleted,
		glyph: "⊘",
	},
};

export type ScheduleStatusOption = { value: ScheduleStatus; label: string };

export const SCHEDULE_STATUS_OPTIONS: ScheduleStatusOption[] = Object.entries(SCHEDULE_STATUS_CONFIG).map(
	([value, { label }]) => ({
		value: value as ScheduleStatus,
		label,
	})
);
