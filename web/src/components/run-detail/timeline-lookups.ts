import type { EventWaitQueue } from "@aikirun/types/event";
import type { SleepQueue } from "@aikirun/types/sleep";
import type { StateTransition } from "@aikirun/types/state-transition";
import type { TaskInfo } from "@aikirun/types/task";
import type { ChildWorkflowRunInfo } from "@aikirun/types/workflow-run";

export interface TimelineLookups {
	childWorkflowById: Map<string, ChildWorkflowRunInfo>;
	taskById: Map<string, TaskInfo>;
	scheduledContext: Map<
		number,
		{
			eventData?: unknown;
			eventDataName?: string;
			eventTimedOut?: boolean;
			actualSleepDuration?: string;
			childWorkflowStatus?: string;
			childWorkflowTimedOut?: boolean;
			scheduledByChildWorkflowRunId?: string;
		}
	>;
}

export type ScheduledContext = NonNullable<ReturnType<TimelineLookups["scheduledContext"]["get"]>>;

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
	return `${(ms / 3600000).toFixed(1)}h`;
}

export function buildTimelineLookups(
	transitions: StateTransition[],
	eventWaitQueues: Record<string, EventWaitQueue<unknown>>,
	sleepQueues: Record<string, SleepQueue>,
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo>,
	taskById: Map<string, TaskInfo>
): TimelineLookups {
	const childWorkflowById = new Map<string, ChildWorkflowRunInfo>();
	for (const child of Object.values(childWorkflowRuns)) {
		childWorkflowById.set(child.id, child);
	}

	const scheduledContext = new Map<number, ScheduledContext>();

	for (let i = 0; i < transitions.length; i++) {
		const t = transitions[i];
		if (t.type !== "workflow_run") continue;
		const state = t.state;

		// Process scheduled transitions
		if (state.status === "scheduled" || state.status === "queued") {
			const reason = state.reason;
			const context: ScheduledContext = {};

			// Handle awake/awake_early - look up the previous sleeping transition
			if (reason === "awake" || reason === "awake_early") {
				for (let j = i - 1; j >= 0; j--) {
					const prev = transitions[j];
					if (prev.type === "workflow_run" && prev.state.status === "sleeping") {
						const sleepName = prev.state.sleepName;
						const queue = sleepQueues[sleepName];
						if (queue?.sleeps.length > 0) {
							let sleepIndex = 0;
							for (let k = 0; k < j; k++) {
								const t2 = transitions[k];
								if (t2.type === "workflow_run" && t2.state.status === "sleeping" && t2.state.sleepName === sleepName) {
									sleepIndex++;
								}
							}
							const sleep = queue.sleeps[sleepIndex];
							if (sleep?.status === "completed") {
								context.actualSleepDuration = formatDuration(sleep.durationMs);
							}
						}
						break;
					}
				}
			}

			// Handle event - look up the previous awaiting_event transition
			if (reason === "event") {
				for (let j = i - 1; j >= 0; j--) {
					const prev = transitions[j];
					if (prev.type === "workflow_run" && prev.state.status === "awaiting_event") {
						const eventName = prev.state.eventName;
						context.eventDataName = eventName;
						const queue = eventWaitQueues[eventName];
						if (queue?.eventWaits.length > 0) {
							let eventIndex = 0;
							for (let k = 0; k < j; k++) {
								const t2 = transitions[k];
								if (
									t2.type === "workflow_run" &&
									t2.state.status === "awaiting_event" &&
									t2.state.eventName === eventName
								) {
									eventIndex++;
								}
							}
							const event = queue.eventWaits[eventIndex];
							if (event?.status === "received") {
								context.eventData = event.data;
							} else if (event?.status === "timeout") {
								context.eventTimedOut = true;
							}
						}
						break;
					}
				}
			}

			// Handle child_workflow - look up the previous awaiting_child_workflow transition
			if (reason === "child_workflow") {
				for (let j = i - 1; j >= 0; j--) {
					const prev = transitions[j];
					if (prev.type === "workflow_run" && prev.state.status === "awaiting_child_workflow") {
						const childId = prev.state.childWorkflowRunId;
						const waitForStatus = prev.state.childWorkflowRunStatus;
						context.scheduledByChildWorkflowRunId = childId;
						const childInfo = childWorkflowById.get(childId);
						const waitQueue = childInfo?.childWorkflowRunWaitQueues[waitForStatus];
						const waits = waitQueue?.childWorkflowRunWaits;
						if (waits && waits.length > 0) {
							let waitIndex = 0;
							for (let k = 0; k < j; k++) {
								const t2 = transitions[k];
								if (
									t2.type === "workflow_run" &&
									t2.state.status === "awaiting_child_workflow" &&
									t2.state.childWorkflowRunId === childId
								) {
									waitIndex++;
								}
							}
							const result = waits[waitIndex];
							if (result?.status === "completed") {
								context.childWorkflowStatus = result.childWorkflowRunState.status;
							} else if (result?.status === "timeout") {
								context.childWorkflowTimedOut = true;
							}
						}
						break;
					}
				}
			}

			if (Object.keys(context).length > 0) {
				scheduledContext.set(i, context);
			}
		}
	}

	return { childWorkflowById, taskById, scheduledContext };
}

export interface TransitionWithMetadata {
	transition: StateTransition;
	index: number;
	dateStr: string;
	dateChanged: boolean;
	attemptChanged: boolean;
	attemptNumber: number;
}

export function buildTransitionsWithMetadata(transitions: StateTransition[]): TransitionWithMetadata[] {
	let lastDate = "";
	let currentAttempt = 1;

	return transitions.map((transition, index) => {
		const date = new Date(transition.createdAt);
		const dateStr = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

		const dateChanged = dateStr !== lastDate;
		lastDate = dateStr;

		let attemptChanged = false;

		if (
			transition.type === "workflow_run" &&
			transition.state.status === "scheduled" &&
			(transition.state.reason === "new" || transition.state.reason === "retry")
		) {
			currentAttempt++;
			attemptChanged = true;
		}

		return { transition, index, dateStr, dateChanged, attemptChanged, attemptNumber: currentAttempt };
	});
}
