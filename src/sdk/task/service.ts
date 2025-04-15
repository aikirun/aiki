import { WorkflowRun } from "../workflow-run/index.ts";
import { Task, TaskParams, TaskRunParams } from "./type.ts";

export class TaskImpl<Payload, Result> implements Task<Payload, Result> {
	constructor(private readonly params: TaskParams<Payload, Result>) {}

	public async run<WorkflowPayload, WorkflowResult>(
		workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>, 
		runParams: TaskRunParams<Payload>
	): Promise<Result> {
		const path = this.getPath(workflowRun, runParams);

		const preExistingResult = await workflowRun._getSubTaskRunResult<Result>(path);
		if (preExistingResult.state === "completed") {
			return preExistingResult.result;
		}

		// TODO: check if result state is failed and there are still retries left
		// if not return failed result
		try {
			const result = await this.params.run(runParams);
			await workflowRun._addSubTaskRunResult(path, {
				state: "completed",
				result
			});
		} catch (error) {
			workflowRun._addSubTaskRunResult(path, {
				state: "failed",
				// TODO: is error string?
				reason: error as string
			});
		}

		// TODO: specify error type
		throw new Error();
	}

	private getPath<WorkflowPayload, WorkflowResult>(
		workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>,
		runParams: TaskRunParams<Payload>
	): string {
		const payloadString = JSON.stringify(runParams.payload);

		return runParams.idempotencyKey
			? `${workflowRun.path}/${this.params.name}/${runParams.idempotencyKey}/${payloadString}`
			: `${workflowRun.path}/${this.params.name}/${payloadString}`;
	}
}