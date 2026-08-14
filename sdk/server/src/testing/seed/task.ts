import type { FakePublisher } from "@aikirun/testing/infra/queue";

import { type SeedRunDeps, seedClaimedRun } from "./run";
import { createTaskStateMachineService } from "../../service/task-state-machine";
import { namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededTask = {
	name: "reserve-inventory",
	input: { sku: "SKU-42", quantity: 3 },
	output: { reservationId: "rsv-1" },
} as const;

export async function seedRunningTask(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });

	const taskStateMachine = createTaskStateMachineService({ repos });
	const taskInfo = await taskStateMachine.transitionState(namespaceRequestContext, {
		type: "create",
		workflowRunId: seeded.runId,
		expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
		taskName: seededTask.name,
		input: seededTask.input,
		taskState: { status: "running" },
	});

	return { ...seeded, taskInfo, taskInput: seededTask.input };
}

export async function seedCompletedTask(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedRunningTask({ ...deps, namespaceRequestContext });

	const taskStateMachine = createTaskStateMachineService({ repos });
	const taskInfo = await taskStateMachine.transitionState(namespaceRequestContext, {
		id: seeded.taskInfo.id,
		workflowRunId: seeded.runId,
		expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
		taskState: { status: "completed", attempts: 1, output: seededTask.output },
	});

	return { ...seeded, taskInfo };
}
