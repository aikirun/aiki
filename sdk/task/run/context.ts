import type { MaybeField } from "@lib/types/object.ts";
import type { RetryStrategy } from "@lib/utils/retry.ts";

export type TaskRunContext<Payload> = MaybeField<"payload", Payload>;

export type TaskRunParams<Payload> = TaskRunContext<Payload> & {
	idempotencyKey?: string;
	retry?: RetryStrategy;
};
