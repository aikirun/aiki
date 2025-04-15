import { WorkflowImpl } from "./service.ts";
import { WorkflowParams, Workflow } from "./type.ts";

export function workflow<
	Payload = undefined, 
	Result = void
>(params: WorkflowParams<Payload, Result>): Workflow<Payload, Result> {
	return new WorkflowImpl(params);
}