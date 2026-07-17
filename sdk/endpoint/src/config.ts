import { asConfigProvider, type CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { type DeepPartial, merge } from "@aikirun/lib/object";
import { CLAIM_REFRESH_INTERVAL_MS } from "@aikirun/types/workflow";
import type { WorkflowExecutionConfig } from "@aikirun/workflow";

export interface EndpointConfig {
	signatureMaxAgeMs: number;
	workflowRun: WorkflowExecutionConfig;
}

export type EndpointConfigOverrides = DeepPartial<EndpointConfig>;

export const defaultEndpointConfig: EndpointConfig = {
	signatureMaxAgeMs: 30_000,
	workflowRun: {
		claimRefreshIntervalMs: CLAIM_REFRESH_INTERVAL_MS,
		spinThresholdMs: 10,
	},
};

/**
 * Endpoint config fixed at construction. Pass `overrides` to change any setting;
 * omit them for the defaults.
 */
export function staticEndpointConfigProvider(
	overrides?: EndpointConfigOverrides
): CreatePassiveConfigProvider<EndpointConfig> {
	const config = merge(defaultEndpointConfig, overrides);
	return () => asConfigProvider(() => config);
}
