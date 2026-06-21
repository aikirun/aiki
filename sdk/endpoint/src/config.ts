import { asConfigProvider, type CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { type DeepPartial, merge } from "@aikirun/lib/object";

export interface EndpointConfig {
	signatureMaxAgeMs: number;
	workflowRun: {
		heartbeatIntervalMs: number;
		spinThresholdMs: number;
	};
}

export type EndpointConfigOverrides = DeepPartial<EndpointConfig>;

export const defaultEndpointConfig: EndpointConfig = {
	signatureMaxAgeMs: 30_000,
	workflowRun: {
		heartbeatIntervalMs: 30_000,
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
