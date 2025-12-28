---
"@aikirun/lib": minor
"@aikirun/client": minor
"@aikirun/task": minor
"@aikirun/worker": minor
"@aikirun/workflow": minor
"@aikirun/server": minor
"@aikirun/types": minor
---

### Child Workflow Runs

Workflows can now spawn and manage child workflows using `workflow.startAsChild()`.

- `waitForStatus()` waits for child to reach a terminal status
- Optional timeout support with `{ timeout: { minutes: 5 } }`
- Race condition prevention: atomic check when transitioning to `awaiting_child_workflow`

### Event Multicasters

Added event multicasters for broadcasting events to multiple workflow runs.

### Handle Improvements

- `waitForStatus()` renamed from `waitForState()` for clarity
- `awake()` method added to wake sleeping workflows
- Event data type defaults to `undefined` when not specified

### Workflow Output Validation

Workflow input and output are now verified at compile time to be serializable.

### Handler Return Type Inference

Handler return type can now be auto-inferred from the handler body - no need to annotate.

### Bug Fixes

- Fixed race condition where events arriving between workflow start and event wait were missed
- Fixed incorrect condition negation when waiting for child workflow status
- Fixed `WorkflowRunFailedError` not precluding further retries
- Disallowed state transitions from awaiting states to paused (resuming from paused would skip the awaited operation)
