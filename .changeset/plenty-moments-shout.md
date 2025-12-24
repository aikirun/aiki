---
"@aikirun/lib": minor
"@aikirun/client": minor
"@aikirun/task": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/server": minor
"@aikirun/types": minor
---

Add workflow events for external signal handling

- Define type-safe events on workflow versions with optional schema validation
- Wait for events inside workflows with optional timeout
- Send events via typed handles (from start() or getHandle())
- Queue-based model with idempotency key support for deduplication
- New `awaiting_retry` state for tasks when retry delay exceeds spin threshold
- Workers now send time deltas instead of absolute timestamps to resolve clock skew
- Fix assertRetryAllowed to transition workflow to failed state before throwing
- Fix clock skew in task retry: suspend on Redis redelivery, let server schedule
