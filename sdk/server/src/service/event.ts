import { NotFoundError } from "@aikirun/lib/error";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import type { EventReference, WorkflowRunId } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { WorkflowRunStateMachine } from "./state-machine/workflow-run";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { EventWaitRowInsert } from "../infra/db/types/event-wait";
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
	const runWithState = await txRepos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
	if (!runWithState) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	const { run, state } = runWithState;

	const eventWaitEntry: EventWaitRowInsert = {
		id: ulid(),
		workflowRunId: runId,
		name: eventName,
		status: "received",
		referenceId: reference?.id,
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
