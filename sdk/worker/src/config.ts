import { asConfigProvider, type CreateConfigProvider, dynamicConfigProvider } from "@aikirun/lib/config";
import { type DeepPartial, merge } from "@aikirun/lib/object";
import { CLAIM_REFRESH_INTERVAL_MS } from "@aikirun/types/workflow";
import type { WorkflowExecutionConfig } from "@aikirun/workflow";

export interface WorkerConfig {
	maxConcurrentWorkflowRuns: number;
	gracefulShutdownTimeoutMs: number;
	workflowRun: WorkflowExecutionConfig;
}

export type WorkerConfigOverrides = DeepPartial<WorkerConfig>;

export const defaultWorkerConfig: WorkerConfig = {
	maxConcurrentWorkflowRuns: 1,
	gracefulShutdownTimeoutMs: 5_000,
	workflowRun: {
		claimRefreshIntervalMs: CLAIM_REFRESH_INTERVAL_MS,
		spinThresholdMs: 10,
	},
};

/**
 * Worker config fixed at start. Pass `overrides` to change any setting; omit them
 * for the defaults.
 */
export function staticWorkerConfigProvider(overrides?: WorkerConfigOverrides): CreateConfigProvider<WorkerConfig> {
	const config = merge(defaultWorkerConfig, overrides);
	return () => asConfigProvider(() => config);
}

/**
 * Worker config that reloads on a timer, letting an operator retune a running
 * worker without redeploying. `refresh` receives the current config and returns the next.
 * The worker starts on defaults with `initial` overrided applied.
 * Every refresh runs in the background, and a failed refresh keeps the current snapshot.
 */
export function dynamicWorkerConfigProvider(params: {
	initial?: WorkerConfigOverrides;
	refresh: (current: WorkerConfig) => WorkerConfig | Promise<WorkerConfig>;
	refreshIntervalMs: number;
}): CreateConfigProvider<WorkerConfig> {
	return dynamicConfigProvider({
		initial: merge(defaultWorkerConfig, params.initial),
		refresh: params.refresh,
		refreshIntervalMs: params.refreshIntervalMs,
	});
}
