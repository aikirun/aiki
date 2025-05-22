import type { MaybeField } from "@lib/types/object.ts";
import type { WorkflowRun } from "./definition.ts";
import type { TriggerStrategy } from "@lib/utils/trigger.ts";

export interface WorkflowRunContext<Payload, Result> {
  workflowRun: WorkflowRun<Payload, Result>;
}

export type WorkflowRunParams<Payload> = MaybeField<"payload", Payload> & {
  idempotencyKey?: string;
  trigger?: TriggerStrategy;
};
