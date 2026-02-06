import { implement, ORPCError } from "@orpc/server";
import { publicContract } from "server/contract/public";

import { namespaceAuthedContract } from "../contract/namespace-authed";
import { organizationAuthedContract } from "../contract/organization-authed";
import {
	InvalidTaskStateTransitionError,
	InvalidWorkflowRunStateTransitionError,
	NotFoundError,
	ScheduleConflictError,
	TaskConflictError,
	UnauthorizedError,
	ValidationError,
	WorkflowRunConflictError,
	WorkflowRunRevisionConflictError,
} from "../errors";
import type {
	ContextBase,
	NamespaceRequestContext,
	OrganizationRequestContext,
	PublicRequestContext,
} from "../middleware/context";

const basePublicImplementer = implement(publicContract).$context<PublicRequestContext>();
const baseOrganizationAuthedImplementer = implement(organizationAuthedContract).$context<OrganizationRequestContext>();
const baseNamespaceAuthedImplementer = implement(namespaceAuthedContract).$context<NamespaceRequestContext>();

function handleError<T extends ContextBase>(context: T, error: unknown) {
	if (context.type === "cron") {
		throw error;
	}

	if (error instanceof NotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}

	if (error instanceof ValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}

	if (error instanceof UnauthorizedError) {
		throw new ORPCError("UNAUTHORIZED", { message: error.message });
	}

	if (error instanceof WorkflowRunRevisionConflictError) {
		throw new ORPCError("WORKFLOW_RUN_REVISION_CONFLICT", { message: error.message, status: 409 });
	}

	if (error instanceof WorkflowRunConflictError) {
		throw new ORPCError("WORKFLOW_RUN_CONFLICT", { message: error.message, status: 409 });
	}

	if (error instanceof TaskConflictError) {
		throw new ORPCError("TASK_CONFLICT", { message: error.message, status: 409 });
	}

	if (error instanceof ScheduleConflictError) {
		throw new ORPCError("SCHEDULE_CONFLICT", { message: error.message, status: 409 });
	}

	if (error instanceof InvalidWorkflowRunStateTransitionError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}

	if (error instanceof InvalidTaskStateTransitionError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}

	context.logger.error(
		{
			errorName: error instanceof Error ? error.name : "Unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
			error,
		},
		"Request error occurred"
	);

	throw error;
}

const publicErrorHandler = basePublicImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		handleError(context, error);
		throw error;
	}
});

const organizationAuthedErrorHandler = baseOrganizationAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		handleError(context, error);
		throw error;
	}
});

const namespaceAuthedErrorHandler = baseNamespaceAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		handleError(context, error);
		throw error;
	}
});

export const publicImplementer = basePublicImplementer.use(publicErrorHandler);
export const organizationAuthedImplementer = baseOrganizationAuthedImplementer.use(organizationAuthedErrorHandler);
export const namespaceAuthedImplementer = baseNamespaceAuthedImplementer.use(namespaceAuthedErrorHandler);
