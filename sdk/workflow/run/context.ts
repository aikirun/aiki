import type { WorkflowRunRow } from "@aiki/contract/workflow-run";
import type { Logger } from "../../logger/mod.ts";
import type { WorkflowRunHandle } from "./run-handle.ts";

export interface WorkflowRunContext<Input, Output>
	extends Pick<WorkflowRunRow<Input, Output>, "id" | "name" | "versionId" | "options"> {
	handle: WorkflowRunHandle<Input, Output>;
	logger: Logger;
}
