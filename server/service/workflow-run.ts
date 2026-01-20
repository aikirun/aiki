import { hashInput, toMilliseconds } from "@aikirun/lib";
import { getWorkflowRunAddress } from "@aikirun/lib/address";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import type { WorkflowRunCreateRequestV1 } from "@aikirun/types/workflow-run-api";
import { NotFoundError, WorkflowRunConflictError } from "server/errors";
import { workflowRunsById, workflowRunsByReferenceId, workflowsByName } from "server/infra/db/in-memory-store";
import type { Context } from "server/middleware/context";

export async function createWorkflowRun(context: Context, request: WorkflowRunCreateRequestV1): Promise<WorkflowRun> {
	const name = request.name as WorkflowName;
	const versionId = request.versionId as WorkflowVersionId;
	const parentWorkflowRunId = request.parentWorkflowRunId as WorkflowRunId;
	const { input, options } = request;
	const referenceId = options?.reference?.id;
	const inputHash = await hashInput(input);

	if (referenceId) {
		const existingRunId = workflowRunsByReferenceId.get(name)?.get(versionId)?.get(referenceId);
		if (existingRunId) {
			const existingRun = workflowRunsById.get(existingRunId);
			if (!existingRun) {
				throw new NotFoundError(`Workflow run not found: ${existingRunId}`);
			}

			if (existingRun.inputHash !== inputHash) {
				const conflictPolicy = options?.reference?.conflictPolicy ?? "error";
				if (conflictPolicy === "error") {
					throw new WorkflowRunConflictError(referenceId);
				}
			}

			context.logger.info({ runId: existingRunId, referenceId }, "Returning existing run from reference ID");
			return existingRun;
		}
	}

	const now = Date.now();
	const runId = crypto.randomUUID() as WorkflowRunId;

	const address = getWorkflowRunAddress(name, versionId, referenceId ?? inputHash);
	const trigger = options?.trigger;

	let scheduledAt = now;
	if (trigger && trigger.type === "delayed") {
		scheduledAt = "delayMs" in trigger ? now + trigger.delayMs : now + toMilliseconds(trigger.delay);
	}

	const run: WorkflowRun = {
		id: runId,
		address,
		name,
		versionId,
		createdAt: now,
		revision: 0,
		attempts: 0,
		input,
		inputHash,
		options: options ?? {},
		state: {
			status: "scheduled",
			scheduledAt,
			reason: "new",
		},
		tasks: {},
		sleepsQueue: {},
		eventWaitQueues: {},
		childWorkflowRuns: {},
		parentWorkflowRunId,
	};

	workflowRunsById.set(runId, run);

	let workflow = workflowsByName.get(name);
	if (!workflow) {
		workflow = {
			name,
			versions: {},
			runCount: 0,
			lastRunAt: now,
		};
		workflowsByName.set(name, workflow);
	}

	workflow.runCount++;
	workflow.lastRunAt = now;

	let workflowVersion = workflow.versions[versionId];
	if (!workflowVersion) {
		workflowVersion = {
			firstSeenAt: now,
			lastRunAt: now,
			runCount: 0,
		};
		workflow.versions[versionId] = workflowVersion;
	}

	workflowVersion.runCount++;
	workflowVersion.lastRunAt = now;

	if (parentWorkflowRunId) {
		const parentRun = workflowRunsById.get(parentWorkflowRunId);
		if (parentRun) {
			parentRun.childWorkflowRuns[run.address] = {
				id: runId,
				name,
				versionId,
				inputHash,
				statusWaitResults: [],
			};
		}
	}

	if (referenceId) {
		let versionMap = workflowRunsByReferenceId.get(name);
		if (!versionMap) {
			versionMap = new Map();
			workflowRunsByReferenceId.set(name, versionMap);
		}

		let referenceIdMap = versionMap.get(versionId);
		if (!referenceIdMap) {
			referenceIdMap = new Map();
			versionMap.set(versionId, referenceIdMap);
		}

		referenceIdMap.set(referenceId, runId);
	}

	context.logger.info(
		{ workflowName: name, versionId, runId, referenceId, opts: run.options, input: run.input },
		"Created workflow run"
	);

	return run;
}
