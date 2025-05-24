import type { MaybeField } from "@lib/object/mod.ts";
import type { WorkflowRun } from "./definition.ts";
import type { TriggerStrategy } from "@lib/trigger/mod.ts";

export interface WorkflowRunContext<Payload, Result> {
	workflowRun: WorkflowRun<Payload, Result>;
}

export type WorkflowRunParams<Payload> = MaybeField<"payload", Payload> & {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
};
