import type { Logger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import { WorkflowRunFailedError } from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRunHandle } from "./handle";

type UnknownWorkflowRunHandle = WorkflowRunHandle<unknown, unknown, unknown>;

/**
 * Validates data against a schema inside a running workflow. Schema issues
 * fail the run with cause "self" — the data came from this run's own code, so
 * the failure belongs to it.
 */
export function validateWithSchema<T>(
	handle: UnknownWorkflowRunHandle,
	schema: StandardSchemaV1<T>,
	data: unknown,
	logger: Logger,
	errorMessage: string
): T | Promise<T> {
	const schemaValidation = schema["~standard"].validate(data);
	if (schemaValidation instanceof Promise) {
		return validateWithSchemaAsync(handle, schemaValidation, logger, errorMessage);
	}
	if (!schemaValidation.issues) {
		return schemaValidation.value;
	}
	return failOnSchemaIssues(handle, schemaValidation.issues, logger, errorMessage);
}

async function validateWithSchemaAsync<T>(
	handle: UnknownWorkflowRunHandle,
	schemaValidation: Promise<StandardSchemaV1.Result<T>>,
	logger: Logger,
	errorMessage: string
): Promise<T> {
	const schemaValidationResult = await schemaValidation;
	if (!schemaValidationResult.issues) {
		return schemaValidationResult.value;
	}
	return failOnSchemaIssues(handle, schemaValidationResult.issues, logger, errorMessage);
}

async function failOnSchemaIssues(
	handle: UnknownWorkflowRunHandle,
	issues: readonly StandardSchemaV1.Issue[],
	logger: Logger,
	errorMessage: string
): Promise<never> {
	logger.error(errorMessage, { "aiki.issues": issues });
	await handle[INTERNAL].transitionState({
		status: "failed",
		cause: "self",
		error: {
			name: "SchemaValidationError",
			message: JSON.stringify(issues),
		},
	});
	throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
}
