import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkflowRunUsedInTaskHandlerError } from "@aikirun/types/workflow/run";
import type { TaskName } from "@aikirun/types/workflow/task";

export interface TaskHandlerScope {
	taskName: TaskName;
	workflowRunUsedError?: WorkflowRunUsedInTaskHandlerError;
}

// A task handler's scope is set only while that handler's own code is running, including after each
// `await` in it. Workflow code that runs while the handler waits has no scope, even though both use
// the same run. A call made through the run reads this to tell whether a task handler made that call.
export const taskHandlerScopeStorage = new AsyncLocalStorage<TaskHandlerScope>();
