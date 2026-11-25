import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Defines an event type that can be sent to and waited for by workflows.
 *
 * Events are type-first with optional runtime schema validation.
 *
 * @template Data - Type of event data (must be JSON serializable)
 * @param params - Optional event configuration
 * @param params.schema - Optional schema for runtime validation
 * @returns EventDefinition for use in workflows
 *
 * @example
 * ```typescript
 * // Type-only event (no runtime validation)
 * const approved = event<{ by: string }>();
 *
 * // Event with runtime validation
 * const rejected = event<{ by: string; reason: string }>({
 *   schema: z.object({ by: z.string(), reason: z.string() })
 * });
 * ```
 */
export function event(): EventDefinition<void>;
export function event<Data>(params?: EventParams<Data>): EventDefinition<Data>;
export function event<Data>(params?: EventParams<Data>): EventDefinition<Data> {
	return {
		// biome-ignore lint/style/useNamingConvention: phantom type marker
		_type: undefined as Data,
		schema: params?.schema,
	};
}

export interface EventParams<Data> {
	schema?: StandardSchemaV1<Data>;
}

export interface EventDefinition<Data> {
	_type: Data;
	schema?: StandardSchemaV1<Data>;
}

export type EventsDefinition = Record<string, EventDefinition<unknown>>;

export type EventData<TEvent> = TEvent extends EventDefinition<infer Data> ? Data : never;

export type EventsData<TEvents extends EventsDefinition> = {
	[Name in keyof TEvents]: EventData<TEvents[Name]>;
};
