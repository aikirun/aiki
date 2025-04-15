import { MaybeField } from "../../common/object/types.ts";
import { TriggerStrategy } from "../../common/trigger/strategy.ts";
import { WorkflowRun } from "../workflow-run/index.ts";
import { AikiClient } from "../client/index.ts";

export interface WorkflowExecuteParams<Payload, Result> {
	workflowRun: WorkflowRun<Payload, Result>;
}

export interface WorkflowParams<Payload, Result> {
	name: string;
	version: string;
	run: (params: WorkflowExecuteParams<Payload, Result>) => Promise<Result>;
	trigger?: TriggerStrategy;
}

export interface WorkflowRunParamsBase {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
}

export type WorkflowRunParams<Payload> = WorkflowRunParamsBase & MaybeField<"payload", Payload>;

export interface Workflow<Payload, Result> {
	path: string;
	run: (
		client: AikiClient,
		params: WorkflowRunParams<Payload>
	) => Promise<WorkflowRun<Payload, Result>>;
	_execute: (params: WorkflowExecuteParams<Payload, Result>) => Promise<Result>;
}