import type { Serializable } from "@aikirun/lib/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import type { EventsDefinition } from "./run/event";
import {
	type AnyWorkflowVersion,
	type WorkflowVersion,
	WorkflowVersionImpl,
	type WorkflowVersionParams,
} from "./workflow-version";

/**
 * Defines a durable workflow with versioning and multiple task execution.
 *
 * Workflows are long-running business processes that can span hours, days, or longer.
 * They automatically survive crashes, timeouts, and infrastructure failures.
 * Multiple versions of a workflow can run simultaneously, allowing safe deployments.
 *
 * @param params - Workflow configuration
 * @param params.name - Unique workflow name used for identification and routing
 * @returns Workflow instance with version management methods
 *
 * @example
 * ```typescript
 * // Define a workflow
 * export const userOnboarding = workflow({ name: "user-onboarding" });
 *
 * // Define version 1.0
 * export const userOnboardingV1 = userOnboarding.v("1.0.0", {
 *   async handler(run, input: { email: string }) {
 *     run.logger.info("Starting onboarding", { email: input.email });
 *
 *     // Execute tasks
 *     await sendWelcomeEmail.start(run, { email: input.email });
 *     await createUserProfile.start(run, { email: input.email });
 *
 *     // Durable sleep
 *     await run.sleep("onboarding-delay", { days: 1 });
 *
 *     // More tasks
 *     await sendUsageTips.start(run, { email: input.email });
 *
 *     return { success: true };
 *   },
 * });
 *
 * // Deploy version 2.0 alongside 1.0 (no downtime)
 * export const userOnboardingV2 = userOnboarding.v("2.0.0", {
 *   async handler(run, input: { email: string; trial: boolean }) {
 *     // Enhanced version with different logic
 *     // Existing v1.0 workflows continue with their version
 *     // New workflows use v2.0
 *   },
 * });
 * ```
 *
 * @see {@link https://github.com/aikirun/aiki} for complete documentation
 */
export interface WorkflowParams {
	name: string;
}

export interface Workflow<Context> {
	name: WorkflowName;

	v: <
		Input extends Serializable,
		Output extends Serializable,
		TEvents extends EventsDefinition = Record<string, never>,
	>(
		versionId: string,
		params: WorkflowVersionParams<Input, Output, Context, TEvents>
	) => WorkflowVersion<Input, Output, Context, TEvents>;

	[INTERNAL]: {
		getAllVersions: () => AnyWorkflowVersion[];
		getVersion: (versionId: WorkflowVersionId) => AnyWorkflowVersion | undefined;
	};
}

export function workflow<Context = null>(params: WorkflowParams): Workflow<Context> {
	const name = params.name as WorkflowName;
	const workflowVersions = new Map<WorkflowVersionId, AnyWorkflowVersion>();

	return {
		name,

		v(versionId, versionParams) {
			if (workflowVersions.has(versionId as WorkflowVersionId)) {
				throw new Error(`Workflow "${name}:${versionId}" already exists`);
			}

			const workflowVersion = new WorkflowVersionImpl(name, versionId as WorkflowVersionId, versionParams);
			workflowVersions.set(versionId as WorkflowVersionId, workflowVersion);

			return workflowVersion;
		},

		[INTERNAL]: {
			getAllVersions: () => Array.from(workflowVersions.values()),
			getVersion: (versionId) => workflowVersions.get(versionId),
		},
	};
}
