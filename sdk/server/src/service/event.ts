import { NotFoundError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import {
	type EventMulticastResult,
	type EventReference,
	isTerminalWorkflowRunStatus,
	type WorkflowRunId,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { WorkflowRunStateMachine } from "./state-machine/workflow-run";
import { WorkflowRunTerminatedError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { EventWaitRowInsert } from "../infra/db/types/event-wait";
import { runConcurrently } from "../lib/concurrency";
import type { NamespaceRequestContext } from "../middleware/context";

export interface EventServiceDeps {
	repos: Repositories;
	workflowRunStateMachine: WorkflowRunStateMachine;
}

export const createEventService = ({ repos, workflowRunStateMachine }: EventServiceDeps) => ({
	async sendEventToWorkflowRun(
		context: NamespaceRequestContext,
		params: {
			runId: WorkflowRunId;
			eventName: string;
			data: unknown;
			reference: EventReference | undefined;
		}
	): Promise<void> {
		return repos.transaction(async (txRepos) =>
			sendEventToWorkflowRunInTx(context, params, txRepos, workflowRunStateMachine)
		);
	},

	async multicastEventToWorkflowRuns(
		context: NamespaceRequestContext,
		params: {
			runIds: WorkflowRunId[];
			eventName: string;
			data: unknown;
			reference: EventReference | undefined;
		}
	): Promise<EventMulticastResult> {
		const { runIds, eventName, data, reference } = params;

		const sentIds: string[] = [];
		const failedIds: string[] = [];

		await runConcurrently(context, runIds, async (runId, spanCtx) => {
			try {
				await repos.transaction(async (txRepos) =>
					sendEventToWorkflowRunInTx(spanCtx, { runId, eventName, data, reference }, txRepos, workflowRunStateMachine)
				);
				sentIds.push(runId);
			} catch (err) {
				spanCtx.logger.warn("Failed to send event to workflow run", { "aiki.runId": runId, err });
				failedIds.push(runId);
			}
		});

		return { sentIds, failedIds };
	},
});

export type EventService = ReturnType<typeof createEventService>;

async function sendEventToWorkflowRunInTx(
	context: NamespaceRequestContext,
	params: {
		runId: WorkflowRunId;
		eventName: string;
		data: unknown;
		reference: EventReference | undefined;
	},
	txRepos: TxRepositories,
	workflowRunStateMachine: WorkflowRunStateMachine
) {
	const { runId, eventName, data, reference } = params;
	const { namespaceId } = context;

	// acquire lock on run row so that the wakeup is never lost if its current status
	// is running but there is a concurrent state transition moving it to awaiting_event
	const runWithState = await txRepos.workflowRun.incrementSignalSequence({ namespaceId, id: runId });
	if (!runWithState) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	const { run, state } = runWithState;
	if (isTerminalWorkflowRunStatus(run.status)) {
		throw new WorkflowRunTerminatedError(runId, run.status);
	}

	const eventWaitEntry: EventWaitRowInsert = {
		id: ulid(),
		workflowRunId: runId,
		name: eventName,
		status: "received",
		referenceId: reference?.id,
		signalSequence: run.signalSequence,
		data,
	};
	if (propsRequiredNonNull(eventWaitEntry, "referenceId")) {
		await txRepos.eventWait.upsert(eventWaitEntry);
	} else {
		await txRepos.eventWait.insert(eventWaitEntry);
	}

	if (run.status !== "awaiting_event") {
		return;
	}

	if (state.status === "awaiting_event" && state.eventName === eventName) {
		await workflowRunStateMachine.transitionState(
			context,
			{
				type: "optimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
				expectedRevision: run.revision,
			},
			txRepos
		);
	}
}
