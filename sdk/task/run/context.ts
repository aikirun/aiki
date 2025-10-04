import type { MaybeField } from "@aiki/lib/object";
import type { RetryStrategy } from "@aiki/lib/retry";

export type TaskRunContext<Payload> = MaybeField<"payload", Payload>;

export type TaskRunParams<Payload> = TaskRunContext<Payload> & {
	idempotencyKey?: string;
	retry?: RetryStrategy;
};
