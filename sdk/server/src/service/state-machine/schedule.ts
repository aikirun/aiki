import { NotFoundError } from "@aikirun/lib/error";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { ScheduleActiveReason, ScheduleState, ScheduleStatus } from "@aikirun/types/schedule";
import { ulid } from "ulidx";

import { InvalidScheduleStateTransitionError } from "../../errors";
import type { TxRepositories } from "../../infra/db/types";
import type { ScheduleRow, ScheduleRowUpdate } from "../../infra/db/types/schedule";
import type { ImminentRunTimerQueue } from "../../infra/timer/imminent-run-timer-queue";

const scheduleStateTransitionValidator: Record<
	ScheduleStatus,
	Partial<{ active: ScheduleActiveReason; paused: true; inactive: true }>
> = {
	active: { paused: true, inactive: true },
	paused: { active: "resumed", inactive: true },
	inactive: { active: "reactivated" },
};

export function assertIsValidScheduleStateTransition(id: string, from: ScheduleStatus, to: ScheduleState) {
	const validator = scheduleStateTransitionValidator[from][to.status];
	if (validator === undefined) {
		throw new InvalidScheduleStateTransitionError(id, from, to.status);
	}
	if (validator === true) {
		return;
	}
	if (to.status === "active" && validator === to.reason) {
		return;
	}
	throw new InvalidScheduleStateTransitionError(id, from, to.status);
}

export async function writeScheduleStateInTx(
	txRepos: TxRepositories,
	params: {
		namespaceId: NamespaceId;
		id: string;
		state: ScheduleState;
		updates?: Pick<
			ScheduleRowUpdate,
			| "workflowRunInput"
			| "workflowRunInputHash"
			| "clientHasherApplied"
			| "clientCodecApplied"
			| "definitionHash"
			| "referenceId"
		>;
	},
	imminentRunTimerQueue?: ImminentRunTimerQueue
): Promise<ScheduleRow> {
	const transitionId = ulid();
	const row = await txRepos.schedule.update(
		params.namespaceId,
		{ id: params.id },
		{
			...params.updates,
			status: params.state.status,
			latestStateTransitionId: transitionId,
		}
	);
	if (!row) {
		throw new NotFoundError(`Schedule not found: ${params.id}`);
	}
	await txRepos.stateTransition.append({
		id: transitionId,
		type: "schedule",
		scheduleId: row.id,
		revision: row.revision,
		state: params.state,
	});

	if (imminentRunTimerQueue && params.state.status === "active") {
		txRepos.onCommit(() =>
			imminentRunTimerQueue.add([
				{ type: "recurring", id: row.id, dueAt: row.nextRunAt, priority: row.workflowRunOptions?.priority },
			])
		);
	}

	return row;
}

export async function transitionScheduleInTx(
	txRepos: TxRepositories,
	params: { namespaceId: NamespaceId; id: string; state: ScheduleState },
	imminentRunTimerQueue?: ImminentRunTimerQueue
): Promise<void> {
	const { namespaceId, id, state } = params;
	const existing = await txRepos.schedule.get(namespaceId, { id }, { lock: "update" });
	if (!existing) {
		throw new NotFoundError(`Schedule not found: ${id}`);
	}
	if (existing.status === state.status) {
		return;
	}
	assertIsValidScheduleStateTransition(id, existing.status, state);
	await writeScheduleStateInTx(txRepos, params, imminentRunTimerQueue);
}
