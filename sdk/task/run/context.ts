import type { MaybeField } from "@lib/object/mod.ts";
import type { RetryStrategy } from "@lib/retry/mod.ts";

export type TaskRunContext<Payload> = MaybeField<"payload", Payload>;

export type TaskRunParams<Payload> = TaskRunContext<Payload> & {
	idempotencyKey?: string;
	retry?: RetryStrategy;
};
