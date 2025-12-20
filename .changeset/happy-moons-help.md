---
"@aikirun/lib": minor
"@aikirun/client": minor
"@aikirun/task": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/server": minor
"@aikirun/types": minor
---

### New Features

- Add durable sleep to workflow runs
- Add workflow run cancellation
- Implement workflow pause and resume
- Define state machine for workflow and task state transitions

### Breaking Changes

- Rename `worker.start()` to `worker.spawn()`
- Rename `runCtx` to `run`
- Rename `exec` to `handler`
- Rename `WorkflowSleepingError` to `WorkflowSuspendedError`
- Prefix API request/response types with their namespace

### Improvements

- Unify `state-handle` and `run-handle` for interacting with running workflows
- State transitions now return updated state, reducing round trips
- Add reason field to queued state, to distinguish workflows waking up vs being retried
- Only new workflow runs and retries increment the attempt counter
- Remove Redis from docker-compose (users bring their own infrastructure)
