import type { Serializable } from "@aikirun/lib";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";

import type { EventsDefinition } from "./run/event";
import { type WorkflowVersion, WorkflowVersionImpl, type WorkflowVersionParams } from "./workflow-version";

/**
 * Defines a durable workflow with versioning and multiple task execution.
 *
 * Workflows are long-running business processes that can span hours, days, or longer.
 * They automatically survive crashes, timeouts, and infrastructure failures.
 * Multiple versions of a workflow can run simultaneously, allowing safe deployments.
 *
 * @param params - Workflow configuration
 * @param params.id - Unique workflow id used for identification and routing
 * @returns Workflow instance with version management methods
 *
 * @example
 * ```typescript
 * // Define a workflow
 * export const userOnboarding = workflow({ id: "user-onboarding" });
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
export function workflow(params: WorkflowParams): Workflow {
	return new WorkflowImpl(params);
}

export interface WorkflowParams {
	id: string;
}

export interface Workflow {
	id: WorkflowId;

	v: <
		Input extends Serializable,
		Output extends Serializable,
		AppContext = null,
		TEventsDefinition extends EventsDefinition = Record<string, never>,
	>(
		versionId: `${number}.${number}.${number}`,
		params: WorkflowVersionParams<Input, Output, AppContext, TEventsDefinition>
	) => WorkflowVersion<Input, Output, AppContext, TEventsDefinition>;

	[INTERNAL]: {
		getAllVersions: () => WorkflowVersion<unknown, unknown, unknown>[];
		getVersion: (versionId: WorkflowVersionId) => WorkflowVersion<unknown, unknown, unknown> | undefined;
	};
}

class WorkflowImpl implements Workflow {
	public readonly id: WorkflowId;
	public readonly [INTERNAL]: Workflow[typeof INTERNAL];
	private workflowVersions = new Map<WorkflowVersionId, WorkflowVersion<unknown, unknown, unknown>>();

	constructor(params: WorkflowParams) {
		this.id = params.id as WorkflowId;
		this[INTERNAL] = {
			getAllVersions: this.getAllVersions.bind(this),
			getVersion: this.getVersion.bind(this),
		};
	}

	v<Input, Output, AppContext, TEventsDefinition extends EventsDefinition>(
		versionId: `${number}.${number}.${number}`,
		params: WorkflowVersionParams<Input, Output, AppContext, TEventsDefinition>
	): WorkflowVersion<Input, Output, AppContext, TEventsDefinition> {
		if (this.workflowVersions.has(versionId as WorkflowVersionId)) {
			throw new Error(`Workflow "${this.id}/${versionId}" already exists`);
		}

		const workflowVersion = new WorkflowVersionImpl(this.id, versionId as WorkflowVersionId, params);
		this.workflowVersions.set(
			versionId as WorkflowVersionId,
			workflowVersion as unknown as WorkflowVersion<unknown, unknown, unknown>
		);

		return workflowVersion;
	}

	private getAllVersions(): WorkflowVersion<unknown, unknown, unknown>[] {
		return Array.from(this.workflowVersions.values());
	}

	private getVersion(versionId: WorkflowVersionId): WorkflowVersion<unknown, unknown, unknown> | undefined {
		return this.workflowVersions.get(versionId);
	}
}
