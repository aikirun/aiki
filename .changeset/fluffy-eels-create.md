---
"@aikirun/lib": minor
"@aikirun/client": minor
"@aikirun/task": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/server": minor
"@aikirun/types": minor
---

### Breaking Changes

- Renamed `idempotencyKey` to `reference.id` for workflows, tasks and events
- Renamed `workflowId` to `name` on WorkflowVersion and WorkflowRun
- Renamed `taskId` to `taskName`
- Renamed `sleepId` to `sleepName`
- Renamed `eventId` to `eventName`
- Renamed `workerId` to `workerName`. Actual worker ID is now auto-generated UUID
- Renamed `shardKey` to `shard`
- Changed workflow handler signature: order is now `(run, input, context)` instead of `(input, run, context)`
- Separated sleep name and duration into separate args
- Workflow run paths are now internal (only workflow run IDs exposed to users)
- Task paths are now internal (task IDs generated on first run)
- Workflow run IDs now use UUIDs
- `tasksState` renamed to `tasks` (now stores TaskInfo with id, name, state, inputHash)
- `sleepsState` renamed to `sleepsQueue`
- `childWorkflowRunPath` renamed to `childWorkflowRunId`

### New Features

- Added optional input/output schema validation for tasks and workflows (validation errors fail the workflow)
- Builder pattern for event options (`.with().opt()`)
- When event data is void, `data` param not required for `send` method
- Workers can have `reference.id` for external correlation
- `onConflict` policy for reference ID conflicts on workflows and tasks (`"error"` | `"return_existing"`)
- Added `awake_early` scheduled reason to differentiate between duration expiry and manual awakes
- Tasks and child workflows now track `inputHash`
- Added ID to state transitions
- Added `WorkflowRunConflictError` class for conflict handling

### Bug Fixes & Improvements

- When workers hit conflicts during workflow execution, they now leave the message for another worker to retry
- Sleep/wait for event/childWorkflow conflict errors are now converted to suspended errors.
- State transition conflict errors skip retry
- Fixed bug where worker name was passed to message queue instead of ID

### Internal

- Moved shared schema to separate file to prevent circular import
- Added logging improvements (task name in logs, various debug logs)
- Created `getTaskPath`, `getWorkflowRunPath` helper functions
- Created branded types for `WorkerName` and `WorkerId`
- Added `hashInput` helper function
- Renamed "error" module to "serializable"
- Ensured task outputs and event data are serializable
- Removed `TaskStateNone` and `SleepStateNone`
- Changed default server port
