import {
	ClientCodecMissingError,
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

/**
 * True for an error the SDK throws to stop the workflow code and end the execution. It does not
 * report a failure the workflow code can handle.
 */
export function isControlFlowError(err: unknown): err is Error {
	return (
		err instanceof WorkflowRunSuspendedError ||
		err instanceof WorkflowRunStateUnknownError ||
		err instanceof WorkflowRunRevisionConflictError ||
		err instanceof WorkflowRunFailedError ||
		err instanceof WorkflowRunNotExecutableError ||
		err instanceof NonDeterminismError ||
		err instanceof ClientCodecMissingError
	);
}
