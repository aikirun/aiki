import type { EventWaitQueue } from "@aikirun/types/event";
import type { SleepQueue } from "@aikirun/types/sleep";
import type { TaskInfo } from "@aikirun/types/task";
import type { ChildWorkflowRunInfo, WorkflowRunStatus, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import { isTerminalWorkflowRunStatus } from "@aikirun/types/workflow-run";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { client } from "../api/client";
import { useWorkflowRun, useWorkflowRunTransitions } from "../api/hooks";
import { BackLink } from "../components/common/BackLink";
import { CopyButton } from "../components/common/CopyButton";
import {
	AwakeIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CloseIcon,
	PauseIcon,
	ResumeIcon,
	SpinnerIcon,
} from "../components/common/Icons";
import { NotFound } from "../components/common/NotFound";
import { StatusBadge } from "../components/common/StatusBadge";

// Determine which actions are available based on workflow status
function getAvailableActions(status: WorkflowRunStatus) {
	const isTerminal = ["cancelled", "completed", "failed"].includes(status);
	return {
		canCancel: !isTerminal,
		canPause: ["scheduled", "queued", "running"].includes(status),
		canResume: status === "paused",
		canAwake: status === "sleeping",
	};
}

const POLLING_INTERVAL_MS = 2000;

export function RunDetail() {
	const { id } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const {
		data: runData,
		isLoading: runLoading,
		error: runError,
	} = useWorkflowRun(id || "", {
		refetchInterval: (query) => {
			const run = query.state.data?.run;
			if (!run) return false;
			return isTerminalWorkflowRunStatus(run.state.status) ? false : POLLING_INTERVAL_MS;
		},
	});

	const currentRun = runData?.run;

	const shouldPollTransitions = currentRun ? !isTerminalWorkflowRunStatus(currentRun.state.status) : false;

	const { data: transitions, isLoading: transitionsLoading } = useWorkflowRunTransitions(
		id || "",
		{ sort: { field: "createdAt", order: "asc" } },
		{ refetchInterval: shouldPollTransitions ? POLLING_INTERVAL_MS : false }
	);

	const tasks = useMemo(() => (currentRun ? Object.values(currentRun.tasks) : []), [currentRun]);
	const taskById = useMemo(() => {
		const map = new Map<string, TaskInfo>();
		for (const task of tasks) {
			map.set(task.id, task);
		}
		return map;
	}, [tasks]);
	const actions = useMemo(
		() =>
			currentRun
				? getAvailableActions(currentRun.state.status)
				: { canCancel: false, canPause: false, canResume: false, canAwake: false },
		[currentRun]
	);
	const hasActions = actions.canCancel || actions.canPause || actions.canResume || actions.canAwake;

	const invalidateQueries = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["workflow-run", id] });
		queryClient.invalidateQueries({ queryKey: ["workflow-run-transitions", id] });
	}, [queryClient, id]);

	const handleCancel = useCallback(async () => {
		if (!currentRun) return;
		setActionLoading("cancel");
		setActionError(null);
		try {
			await client.workflowRun.transitionStateV1({
				type: "pessimistic",
				id: currentRun.id,
				state: { status: "cancelled" },
			});
			invalidateQueries();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to cancel workflow");
		} finally {
			setActionLoading(null);
		}
	}, [currentRun, invalidateQueries]);

	const handlePause = useCallback(async () => {
		if (!currentRun) return;
		setActionLoading("pause");
		setActionError(null);
		try {
			await client.workflowRun.transitionStateV1({
				type: "pessimistic",
				id: currentRun.id,
				state: { status: "paused" },
			});
			invalidateQueries();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to pause workflow");
		} finally {
			setActionLoading(null);
		}
	}, [currentRun, invalidateQueries]);

	const handleResume = useCallback(async () => {
		if (!currentRun) return;
		setActionLoading("resume");
		setActionError(null);
		try {
			await client.workflowRun.transitionStateV1({
				type: "pessimistic",
				id: currentRun.id,
				state: { status: "scheduled", scheduledInMs: 0, reason: "resume" },
			});
			invalidateQueries();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to resume workflow");
		} finally {
			setActionLoading(null);
		}
	}, [currentRun, invalidateQueries]);

	const handleAwake = useCallback(async () => {
		if (!currentRun) return;
		setActionLoading("awake");
		setActionError(null);
		try {
			await client.workflowRun.transitionStateV1({
				type: "pessimistic",
				id: currentRun.id,
				state: { status: "scheduled", scheduledInMs: 0, reason: "awake_early" },
			});
			invalidateQueries();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to awake workflow");
		} finally {
			setActionLoading(null);
		}
	}, [currentRun, invalidateQueries]);

	if (runLoading) {
		return <RunDetailSkeleton />;
	}

	if (runError || !currentRun) {
		return (
			<NotFound
				title="Run Not Found"
				message="The workflow run you're looking for doesn't exist or may have been deleted."
			/>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<BackLink to={`/workflow/${encodeURIComponent(currentRun.name)}`} />
					<div>
						<h1 className="font-heading text-2xl font-bold text-slate-900">{currentRun.name}</h1>
						<div className="flex items-center gap-1">
							<span className="font-mono text-sm text-slate-500 max-w-[200px] truncate" title={currentRun.id}>
								{currentRun.id}
							</span>
							<CopyButton text={currentRun.id} title="Copy Run ID" />
						</div>
					</div>
					{shouldPollTransitions && <LiveIndicator />}
				</div>

				{/* Action Buttons */}
				{hasActions && (
					<div className="flex items-center gap-2">
						{actions.canAwake && (
							<button
								type="button"
								onClick={handleAwake}
								disabled={actionLoading !== null}
								className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-100 hover:shadow-sm transition-all disabled:opacity-50"
							>
								{actionLoading === "awake" ? <SpinnerIcon /> : <AwakeIcon />}
								Awake
							</button>
						)}
						{actions.canResume && (
							<button
								type="button"
								onClick={handleResume}
								disabled={actionLoading !== null}
								className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm font-medium hover:bg-emerald-100 hover:shadow-sm transition-all disabled:opacity-50"
							>
								{actionLoading === "resume" ? <SpinnerIcon /> : <ResumeIcon />}
								Resume
							</button>
						)}
						{actions.canPause && (
							<button
								type="button"
								onClick={handlePause}
								disabled={actionLoading !== null}
								className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 text-sm font-medium hover:bg-amber-100 hover:shadow-sm transition-all disabled:opacity-50"
							>
								{actionLoading === "pause" ? <SpinnerIcon /> : <PauseIcon />}
								Pause
							</button>
						)}
						{actions.canCancel && (
							<button
								type="button"
								onClick={handleCancel}
								disabled={actionLoading !== null}
								className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium hover:bg-red-100 hover:shadow-sm transition-all disabled:opacity-50"
							>
								{actionLoading === "cancel" ? <SpinnerIcon /> : <CloseIcon />}
								Cancel
							</button>
						)}
					</div>
				)}
			</div>

			{/* Action Error */}
			{actionError && (
				<div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
					<span className="text-red-700 text-sm">{actionError}</span>
					<button type="button" onClick={() => setActionError(null)} className="text-red-500 hover:text-red-700">
						<CloseIcon />
					</button>
				</div>
			)}

			{/* Run Info */}
			<div className="bg-white rounded-2xl border-2 border-slate-200 p-6">
				<div className="grid grid-cols-2 md:grid-cols-4 gap-6">
					<div>
						<div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Status</div>
						<StatusBadge status={currentRun.state.status} />
					</div>
					<div>
						<div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Started</div>
						<div className="text-slate-900 font-medium">{new Date(currentRun.createdAt).toLocaleString()}</div>
					</div>
					<div>
						<div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Version</div>
						<div className="text-slate-900 font-mono text-sm">{currentRun.versionId}</div>
					</div>
					<div>
						<div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Attempt</div>
						<div className="text-slate-900 font-medium">{currentRun.attempts}</div>
					</div>
				</div>
			</div>

			{/* Input */}
			{currentRun.input !== undefined && (
				<CollapsibleSection title="Input" defaultOpen={false}>
					<pre className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto text-sm font-mono">
						{JSON.stringify(currentRun.input, null, 2)}
					</pre>
				</CollapsibleSection>
			)}

			{/* Options */}
			{Object.keys(currentRun.options).length > 0 && (
				<CollapsibleSection title="Options" defaultOpen={false}>
					<pre className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto text-sm font-mono">
						{JSON.stringify(currentRun.options, null, 2)}
					</pre>
				</CollapsibleSection>
			)}

			{/* Output */}
			{currentRun.state.status === "completed" && currentRun.state.output !== undefined && (
				<CollapsibleSection title="Output" defaultOpen={true}>
					<pre className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto text-sm font-mono">
						{JSON.stringify(currentRun.state.output, null, 2)}
					</pre>
				</CollapsibleSection>
			)}

			{/* Error */}
			{currentRun.state.status === "failed" && (
				<CollapsibleSection title="Error" defaultOpen={true}>
					<div className="space-y-3">
						<div className="text-sm">
							<span className="text-slate-500">Cause: </span>
							<span className="font-medium text-red-600">
								{currentRun.state.cause === "self" && "Workflow Error"}
								{currentRun.state.cause === "task" && (
									<>
										Task Failed:{" "}
										<a href={`#task-${currentRun.state.taskId}`} className="text-aiki-purple hover:underline">
											{taskById.get(currentRun.state.taskId)?.name} ({currentRun.state.taskId.slice(0, 8)}...)
										</a>
									</>
								)}
								{currentRun.state.cause === "child_workflow" && (
									<ChildWorkflowFailedLink
										childWorkflowRunId={currentRun.state.childWorkflowRunId}
										childWorkflowRuns={currentRun.childWorkflowRuns}
									/>
								)}
							</span>
						</div>
						{currentRun.state.cause === "self" && (
							<pre className="bg-slate-900 text-red-400 rounded-xl p-4 overflow-x-auto text-sm font-mono">
								{JSON.stringify(currentRun.state.error, null, 2)}
							</pre>
						)}
					</div>
				</CollapsibleSection>
			)}

			{/* Timeline */}
			<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
				<div className="px-6 py-4">
					<h2 className="font-heading text-lg font-semibold text-slate-900">Timeline</h2>
				</div>
				<div className="px-6 pb-6">
					{transitionsLoading ? (
						<TimelineSkeleton />
					) : transitions?.transitions.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No transitions recorded</div>
					) : (
						<Timeline
							transitions={transitions?.transitions || []}
							eventWaitQueues={currentRun.eventWaitQueues}
							sleepsQueue={currentRun.sleepsQueue}
							childWorkflowRuns={currentRun.childWorkflowRuns}
							taskById={taskById}
						/>
					)}
				</div>
			</div>

			{/* Tasks */}
			{tasks.length > 0 && (
				<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
					<div className="px-6 py-4 border-b border-slate-200">
						<h2 className="font-heading text-lg font-semibold text-slate-900">Tasks</h2>
					</div>
					<div className="divide-y divide-slate-100">
						{tasks.map((task) => (
							<TaskCard key={task.id} task={task} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}

interface TimelineLookups {
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

function Timeline({
	transitions,
	eventWaitQueues,
	sleepsQueue,
	childWorkflowRuns,
	taskById,
}: {
	transitions: WorkflowRunTransition[];
	eventWaitQueues: Record<string, EventWaitQueue<unknown>>;
	sleepsQueue: Record<string, SleepQueue>;
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo>;
	taskById: Map<string, TaskInfo>;
}) {
	const lookups = useMemo<TimelineLookups>(() => {
		const childWorkflowById = new Map<string, ChildWorkflowRunInfo>();
		for (const child of Object.values(childWorkflowRuns)) {
			childWorkflowById.set(child.id, child);
		}

		const scheduledContext = new Map<
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
		>();

		const sleepCountByName: Record<string, number> = {};
		const eventCountByName: Record<string, number> = {};
		const childWaitCountById: Record<string, number> = {};

		const lastSleepIndexByName: Record<string, number> = {};
		const lastEventIndexByName: Record<string, number> = {};
		const lastChildWaitIndexById: Record<string, number> = {};

		for (let i = 0; i < transitions.length; i++) {
			const t = transitions[i];
			if (t.type !== "state" || !t.state) continue;
			const state = t.state;

			if (state.status === "sleeping") {
				const sleepName = state.sleepName;
				sleepCountByName[sleepName] = (sleepCountByName[sleepName] || 0) + 1;
				lastSleepIndexByName[sleepName] = i;
			}

			if (state.status === "awaiting_event") {
				const eventName = state.eventName;
				eventCountByName[eventName] = (eventCountByName[eventName] || 0) + 1;
				lastEventIndexByName[eventName] = i;
			}

			if (state.status === "awaiting_child_workflow") {
				const childId = state.childWorkflowRunId;
				childWaitCountById[childId] = (childWaitCountById[childId] || 0) + 1;
				lastChildWaitIndexById[childId] = i;
			}

			// Process scheduled transitions
			if (state.status === "scheduled" || state.status === "queued") {
				const reason = state.reason;
				const context: typeof scheduledContext extends Map<number, infer V> ? V : never = {};

				// Handle awake/awake_early - look up the previous sleeping transition
				if (reason === "awake" || reason === "awake_early") {
					// Find the most recent sleeping transition before this one
					for (let j = i - 1; j >= 0; j--) {
						const prev = transitions[j];
						if (prev.type === "state" && prev.state?.status === "sleeping") {
							const sleepName = prev.state.sleepName;
							const queue = sleepsQueue[sleepName];
							if (queue?.sleeps.length > 0) {
								// Count sleeps before index j
								let sleepIndex = 0;
								for (let k = 0; k < j; k++) {
									const t2 = transitions[k];
									if (t2.type === "state" && t2.state?.status === "sleeping" && t2.state.sleepName === sleepName) {
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
						if (prev.type === "state" && prev.state?.status === "awaiting_event") {
							const eventName = prev.state.eventName;
							context.eventDataName = eventName;
							const queue = eventWaitQueues[eventName];
							if (queue?.eventWaits.length > 0) {
								let eventIndex = 0;
								for (let k = 0; k < j; k++) {
									const t2 = transitions[k];
									if (
										t2.type === "state" &&
										t2.state?.status === "awaiting_event" &&
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
						if (prev.type === "state" && prev.state?.status === "awaiting_child_workflow") {
							const childId = prev.state.childWorkflowRunId;
							context.scheduledByChildWorkflowRunId = childId;
							const childInfo = childWorkflowById.get(childId);
							const statusWaitResults = childInfo?.statusWaitResults;
							if (statusWaitResults && statusWaitResults.length > 0) {
								let waitIndex = 0;
								for (let k = 0; k < j; k++) {
									const t2 = transitions[k];
									if (
										t2.type === "state" &&
										t2.state?.status === "awaiting_child_workflow" &&
										t2.state.childWorkflowRunId === childId
									) {
										waitIndex++;
									}
								}
								const result = statusWaitResults[waitIndex];
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
	}, [transitions, eventWaitQueues, sleepsQueue, childWorkflowRuns, taskById]);

	const transitionsWithMetadata = useMemo(() => {
		let lastDate = "";
		let currentAttempt = 1;

		return transitions.map((transition, index) => {
			const date = new Date(transition.createdAt);
			const dateStr = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

			const dateChanged = dateStr !== lastDate;
			lastDate = dateStr;

			let attemptChanged = false;

			if (
				transition.type === "state" &&
				transition.state?.status === "scheduled" &&
				(transition.state.reason === "new" || transition.state.reason === "retry")
			) {
				currentAttempt++;
				attemptChanged = true;
			}

			return { transition, index, dateStr, dateChanged, attemptChanged, attemptNumber: currentAttempt };
		});
	}, [transitions]);

	return (
		<div className="space-y-0">
			{transitionsWithMetadata.map(({ transition, index, dateStr, dateChanged, attemptChanged, attemptNumber }) => (
				<div key={transition.id}>
					{(dateChanged || attemptChanged) && (
						<TimelineDivider
							date={dateChanged ? dateStr : undefined}
							attempt={attemptChanged ? attemptNumber : undefined}
						/>
					)}
					<TimelineItem
						transition={transition}
						transitionIndex={index}
						lookups={lookups}
						isLast={index === transitions.length - 1}
					/>
				</div>
			))}
		</div>
	);
}

function TimelineDivider({ date, attempt }: { date?: string; attempt?: number }) {
	const label = date && attempt ? `${date} · Attempt ${attempt}` : date ? date : `Attempt ${attempt}`;

	return (
		<div className="flex items-center gap-3 py-2 mb-2">
			<hr className="h-px bg-slate-200 flex-1 border-0" />
			<span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
			<hr className="h-px bg-slate-200 flex-1 border-0" />
		</div>
	);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
	return `${(ms / 3600000).toFixed(1)}h`;
}

const TimelineItem = memo(function TimelineItem({
	transition,
	transitionIndex,
	lookups,
	isLast,
}: {
	transition: WorkflowRunTransition;
	transitionIndex: number;
	lookups: TimelineLookups;
	isLast: boolean;
}) {
	const time = new Date(transition.createdAt).toLocaleTimeString();

	if (transition.type === "state" && transition.state) {
		const state = transition.state;
		const status = state.status;
		const statusLabel = status.replace(/_/g, " ").toUpperCase();

		let reason: string | undefined;
		if (state.status === "scheduled" || state.status === "queued") {
			reason = state.reason;
		}

		let eventName: string | undefined;
		if (state.status === "awaiting_event") {
			eventName = state.eventName;
		}

		let sleepDuration: string | undefined;
		if (state.status === "sleeping") {
			const remainingMs = state.awakeAt - Date.now();
			sleepDuration = remainingMs > 0 ? formatDuration(remainingMs) : "waking up";
		}

		let childWorkflowRunId: string | undefined;
		if (state.status === "awaiting_child_workflow") {
			childWorkflowRunId = state.childWorkflowRunId;
		}

		const scheduledCtx = lookups.scheduledContext.get(transitionIndex);
		const eventDataName = scheduledCtx?.eventDataName;
		const eventData = scheduledCtx?.eventData;
		const eventTimedOut = scheduledCtx?.eventTimedOut ?? false;
		const actualSleepDuration = scheduledCtx?.actualSleepDuration;
		const childWorkflowStatus = scheduledCtx?.childWorkflowStatus;
		const childWorkflowTimedOut = scheduledCtx?.childWorkflowTimedOut ?? false;
		const scheduledByChildWorkflowRunId = scheduledCtx?.scheduledByChildWorkflowRunId;

		return (
			<div className="flex gap-4">
				<div className="flex flex-col items-center">
					<div className={`w-3 h-3 rounded-full ${getStatusColor(status)}`} />
					{!isLast && <div className="w-0.5 bg-slate-200 flex-1 min-h-[24px]" />}
				</div>
				<div className="pb-4 flex-1">
					<div className="text-xs text-slate-500 font-mono">{time}</div>
					<div className="font-semibold text-slate-900">
						{statusLabel}
						{eventName && <span className="text-slate-500 font-normal ml-2">({eventName})</span>}
						{sleepDuration && <span className="text-slate-500 font-normal ml-2">({sleepDuration})</span>}
						{childWorkflowRunId && (
							<ChildWorkflowLink
								childWorkflowRunId={childWorkflowRunId}
								childWorkflowById={lookups.childWorkflowById}
							/>
						)}
						{eventTimedOut && status !== "queued" && (
							<span className="text-amber-600 font-normal ml-2">(timed out)</span>
						)}
						{reason === "awake" && status !== "queued" && (
							<span className="text-slate-500 font-normal ml-2">
								(awake{actualSleepDuration ? `, slept ${actualSleepDuration}` : ""})
							</span>
						)}
						{reason === "awake_early" && status !== "queued" && (
							<span className="text-amber-600 font-normal ml-2">
								(woke early{actualSleepDuration ? `, slept ${actualSleepDuration}` : ""})
							</span>
						)}
						{reason === "child_workflow" && status !== "queued" && scheduledByChildWorkflowRunId && (
							<ChildWorkflowScheduledLink
								childWorkflowRunId={scheduledByChildWorkflowRunId}
								childWorkflowById={lookups.childWorkflowById}
								childWorkflowStatus={childWorkflowStatus}
							/>
						)}
						{childWorkflowTimedOut && status !== "queued" && (
							<span className="text-amber-600 font-normal ml-2">(child timed out)</span>
						)}
						{reason &&
							reason !== "event" &&
							reason !== "awake" &&
							reason !== "awake_early" &&
							reason !== "child_workflow" &&
							!eventName &&
							status !== "queued" && <span className="text-slate-500 font-normal ml-2">({reason})</span>}
					</div>
					{reason === "event" &&
						eventDataName &&
						status !== "queued" &&
						(eventData !== undefined ? (
							<CollapsibleData label={`${eventDataName} data`} defaultOpen={true}>
								{JSON.stringify(eventData, null, 2)}
							</CollapsibleData>
						) : (
							<div className="text-base text-slate-500 mt-1">{eventDataName}</div>
						))}
				</div>
			</div>
		);
	}

	if (transition.type === "task_state" && transition.taskState) {
		const taskStatus = transition.taskState.status;
		const icon =
			taskStatus === "completed" ? "✓" : taskStatus === "failed" ? "✗" : taskStatus === "awaiting_retry" ? "↻" : "●";
		const color =
			taskStatus === "completed"
				? "text-emerald-600"
				: taskStatus === "failed"
					? "text-red-600"
					: taskStatus === "awaiting_retry"
						? "text-orange-600"
						: "text-blue-600";
		const taskInfo = lookups.taskById.get(transition.taskId || "");

		return (
			<div className="flex gap-4">
				<div className="flex flex-col items-center">
					<div className="w-3 h-3" />
					{!isLast && <div className="w-0.5 bg-slate-200 flex-1 min-h-[24px]" />}
				</div>
				<div className="pb-4 pl-4">
					<div className="text-xs text-slate-500 font-mono">{time}</div>
					<a href={`#task-${transition.taskId}`} className={`font-medium ${color} hover:underline`}>
						<span className="mr-2">{icon}</span>
						{taskInfo && <>{taskInfo.name} </>}
						{transition.taskId?.slice(0, 8)}... — {taskStatus}
					</a>
				</div>
			</div>
		);
	}

	return null;
});

function ChildWorkflowLink({
	childWorkflowRunId,
	childWorkflowById,
}: {
	childWorkflowRunId: string;
	childWorkflowById: Map<string, ChildWorkflowRunInfo>;
}) {
	const childInfo = childWorkflowById.get(childWorkflowRunId);
	if (childInfo?.name) {
		return (
			<Link
				to={`/workflow/${encodeURIComponent(childInfo.name)}/run/${childWorkflowRunId}`}
				className="text-aiki-purple hover:underline font-normal ml-2"
			>
				(child: {childInfo.name} <span className="text-slate-400">v{childInfo.versionId.slice(0, 6)}</span>{" "}
				{childWorkflowRunId.slice(0, 8)}...)
			</Link>
		);
	}
	return <span className="text-slate-500 font-normal ml-2">(child: {childWorkflowRunId.slice(0, 8)}...)</span>;
}

function ChildWorkflowScheduledLink({
	childWorkflowRunId,
	childWorkflowById,
	childWorkflowStatus,
}: {
	childWorkflowRunId: string;
	childWorkflowById: Map<string, ChildWorkflowRunInfo>;
	childWorkflowStatus?: string;
}) {
	const childInfo = childWorkflowById.get(childWorkflowRunId);
	if (childInfo?.name) {
		return (
			<Link
				to={`/workflow/${encodeURIComponent(childInfo.name)}/run/${childWorkflowRunId}`}
				className="text-aiki-purple hover:underline font-normal ml-2"
			>
				(child: {childInfo.name} <span className="text-slate-400">v{childInfo.versionId.slice(0, 6)}</span>{" "}
				{childWorkflowRunId.slice(0, 8)}...
				{childWorkflowStatus && ` - ${childWorkflowStatus}`})
			</Link>
		);
	}
	return (
		<span className="text-slate-500 font-normal ml-2">
			(child: {childWorkflowRunId.slice(0, 8)}...
			{childWorkflowStatus && ` - ${childWorkflowStatus}`})
		</span>
	);
}

function getStatusColor(status: string): string {
	switch (status) {
		case "completed":
			return "bg-emerald-500";
		case "failed":
			return "bg-red-500";
		case "running":
		case "queued":
			return "bg-blue-500";
		case "sleeping":
			return "bg-purple-500";
		case "cancelled":
			return "bg-slate-400";
		default:
			return "bg-slate-300";
	}
}

const TaskCard = memo(function TaskCard({ task }: { task: TaskInfo }) {
	const statusIcon = task.state.status === "completed" ? "✓" : task.state.status === "failed" ? "✗" : "●";
	const statusColor =
		task.state.status === "completed"
			? "text-emerald-600"
			: task.state.status === "failed"
				? "text-red-600"
				: "text-blue-600";

	return (
		<div id={`task-${task.id}`} className="px-6 py-4 scroll-mt-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="font-medium text-slate-900">{task.name}</div>
					<div className="flex items-center gap-1">
						<span className="text-xs text-slate-500 font-mono max-w-[120px] truncate" title={task.id}>
							{task.id}
						</span>
						<CopyButton text={task.id} title="Copy Task ID" />
					</div>
				</div>
				<div className="flex items-center gap-4">
					<span className={`font-semibold ${statusColor}`}>
						{statusIcon} {task.state.status}
					</span>
					<span className="text-slate-500 text-sm">
						{task.state.attempts} attempt{task.state.attempts !== 1 ? "s" : ""}
					</span>
				</div>
			</div>
			{task.state.status === "running" && (
				<CollapsibleData label="Input" defaultOpen={false}>
					{JSON.stringify(task.state.input, null, 2)}
				</CollapsibleData>
			)}
			{task.state.status === "completed" && task.state.output !== undefined && (
				<CollapsibleData label="Output" defaultOpen={false}>
					{JSON.stringify(task.state.output, null, 2)}
				</CollapsibleData>
			)}
			{(task.state.status === "failed" || task.state.status === "awaiting_retry") && (
				<CollapsibleData label="Error" defaultOpen={true}>
					{JSON.stringify(task.state.error, null, 2)}
				</CollapsibleData>
			)}
		</div>
	);
});

function LiveIndicator() {
	return (
		<div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-100 border border-emerald-300 rounded-full">
			<span className="relative flex h-2.5 w-2.5 items-center justify-center">
				<span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-emerald-500 opacity-75" />
				<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
			</span>
			<span className="text-xs font-bold text-emerald-800">Live</span>
		</div>
	);
}

function RunDetailSkeleton() {
	return (
		<div className="space-y-8 animate-pulse">
			<div className="flex items-center gap-4">
				<div className="h-6 bg-slate-200 rounded w-16" />
				<div className="h-8 bg-slate-200 rounded w-48" />
			</div>
			<div className="bg-white rounded-2xl border-2 border-slate-200 p-6">
				<div className="grid grid-cols-4 gap-6">
					{Array.from({ length: 4 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<div key={i}>
							<div className="h-3 bg-slate-200 rounded w-16 mb-2" />
							<div className="h-6 bg-slate-200 rounded w-24" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function TimelineSkeleton() {
	return (
		<div className="space-y-4 animate-pulse">
			{Array.from({ length: 4 }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
				<div key={i} className="flex gap-4">
					<div className="w-3 h-3 bg-slate-200 rounded-full" />
					<div className="flex-1">
						<div className="h-3 bg-slate-200 rounded w-16 mb-1" />
						<div className="h-5 bg-slate-200 rounded w-32" />
					</div>
				</div>
			))}
		</div>
	);
}

function CollapsibleSection({
	title,
	defaultOpen,
	children,
}: {
	title: string;
	defaultOpen: boolean;
	children: React.ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="w-full px-6 py-4 border-b border-slate-200 flex items-center justify-between hover:bg-slate-50 transition-colors"
			>
				<h2 className="font-heading text-lg font-semibold text-slate-900">{title}</h2>
				<ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>
			{isOpen && <div className="p-6">{children}</div>}
		</div>
	);
}

function CollapsibleData({ label, defaultOpen, children }: { label: string; defaultOpen: boolean; children: string }) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-1 text-base text-slate-500 hover:text-slate-700 transition-colors"
			>
				<ChevronRightIcon className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
				{label}
			</button>
			{isOpen && (
				<pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs mt-1 overflow-x-auto font-mono">
					{children}
				</pre>
			)}
		</div>
	);
}

function ChildWorkflowFailedLink({
	childWorkflowRunId,
	childWorkflowRuns,
}: {
	childWorkflowRunId: string;
	childWorkflowRuns: Record<string, ChildWorkflowRunInfo>;
}) {
	const childInfo = Object.values(childWorkflowRuns).find((c) => c.id === childWorkflowRunId);
	if (childInfo?.name) {
		return (
			<>
				Child Workflow Failed{" "}
				<Link
					to={`/workflow/${encodeURIComponent(childInfo.name)}/run/${childWorkflowRunId}`}
					className="text-aiki-purple hover:underline"
				>
					({childWorkflowRunId.slice(0, 8)}...)
				</Link>
			</>
		);
	}
	return <>Child Workflow Failed ({childWorkflowRunId.slice(0, 8)}...)</>;
}
