# Aiki TODO

This document tracks planned features and improvements for the Aiki durable workflow engine.

## Priority 0: Production Blockers 🚨

These items block production adoption and must be implemented first.

### Task Reliability
- [ ] **Task Retry Logic**: Implement automatic retry with exponential backoff for failed tasks
  - Currently TODO in `sdk/task/task.ts:66` - tasks fail permanently without retries
  - Need to track retry attempts, implement backoff delays, persist retry state
  - Critical for production reliability
- [ ] **Error Serialization**: Proper error capture with stack traces and context
  - Currently TODO in `sdk/task/task.ts:78` - errors cast to string without context
  - Need to serialize Error objects with message, stack, cause, name

### Workflow Results
- [ ] **Workflow Result Persistence**: Store and retrieve workflow execution results
  - Currently TODO in `sdk/workflow/version/workflow-version.ts:81`
  - Need server API endpoint and database schema for output storage
  - Required for `WorkflowRunResultHandle` to actually return results

### Type Safety
- [ ] **Task Result Type Validation**: Runtime validation of pre-existing task results
  - Currently TODO in `sdk/workflow/run/run-handle.ts:48`
  - Add Zod schema validation or runtime type checks

---

## Priority 1: Core Features 🎯

Essential features for workflow orchestration.

### Workflow Primitives
- [ ] **Durable Sleep/Timers**: Add `sleep()` and scheduled task execution
  - Required for delayed workflows, rate limiting, polling patterns
  - Must survive worker restarts
- [ ] **Workflow Timeouts**: Add maximum execution time limits for workflows
  - Prevent infinite loops and runaway workflows
- [ ] **Workflow Cancellation**: Allow cancellation of workflows and tasks in progress
  - Need graceful cancellation with cleanup handlers

### Event System (Redis Streams Based)
- [ ] **Signal/Event System**: Send events to running workflows (Redis Streams based)
  - Enable human-in-the-loop workflows (approvals, reviews)
  - Support external event handling
  - Use Redis Streams for event delivery
  - Required for long-running workflows
- [ ] **Eliminate Polling Strategies**: Remove polling and adaptive polling subscriber strategies
  - Keep only Redis Streams strategy
  - Reduces implementation complexity and maintenance burden
  - Simplifies deployment (only need Redis)

### Workflow Orchestration
- [ ] **Sub-workflows**: Enable workflows to trigger and orchestrate other workflows
  - Parent-child relationship tracking
  - Parallel sub-workflow execution
- [ ] **Workflow Scheduling**: Add cron-based and time-based workflow scheduling
  - Support one-time delayed execution
  - Support recurring schedules (cron expressions)

---

## Priority 2: Developer Experience 🛠️

Improvements to make Aiki easier to use and debug.

### Testing & Debugging
- [ ] **Testing Utilities**: Add test helpers and mocks for workflow testing
  - Mock task execution
  - Time travel for timer testing
  - Local test mode without server
- [ ] **Workflow History/Timeline**: Visualize workflow execution history
  - Show task execution order, durations, retries
  - Debug failed workflows
  - Export execution traces

### Observability
- [ ] **Enhanced Workflow Status**: Provide detailed view of tasks executed within a workflow
  - Real-time task completion tracking
  - Progress indicators
- [ ] **Better Error Handling**: Improve error messages, types and debugging information
  - Structured error types
  - Error codes and categories
  - Actionable error messages

### Documentation
- [ ] **API Documentation**: Comprehensive API docs with examples
  - Getting started guide
  - API reference
  - Best practices
- [ ] **Code Examples**: Real-world workflow examples
  - Common patterns (retries, approvals, fan-out/fan-in)
  - Integration examples

---

## Priority 3: Package Architecture 📦

Modularization for better tree-shaking and deployment flexibility.

### Independent Packages
- [ ] **Split into separate packages**: Enable independent installation
  - `@aiki/workflow` - Workflow definition APIs
  - `@aiki/task` - Task definition and execution
  - `@aiki/worker` - Worker infrastructure
  - `@aiki/client` - Client SDK for starting workflows
  - Benefits: Tree-shaking, smaller bundles, clearer dependencies

### Streaming & Real-time
- [ ] **Result Streaming**: Stream workflow results and events down to SDK (Redis Streams based)
  - Real-time progress updates
  - Event notifications
  - Use Redis Streams XREAD for consumption

---

## Priority 4: Advanced Features 🚀

Nice-to-have features for advanced use cases.

### Execution Control
- [ ] **Block Until Complete**: Add method to wait for workflow completion
  - Synchronous workflow execution option
- [ ] **Workflow Pausing**: Support for pausing workflows mid-execution
  - Manual pause/resume
- [ ] **Webhook Integration**: Pause workflow execution until external webhook is called
  - Callback URLs for external systems

### Task Management
- [ ] **Task Cancellation**: Implement graceful task cancellation with status checking
  - Workers check cancellation status before updating storage
- [ ] **Task Dependencies**: Add support for task dependencies and conditional execution
  - DAG-based execution
  - Conditional branching
- [ ] **Task Timeouts**: Add per-task timeout configuration

### Lifecycle Hooks
- [ ] **Pre-workflow Tasks**: Tasks that run exactly once before workflow execution starts
  - Setup, initialization
- [ ] **Post-workflow Tasks**: Tasks that run when workflow completes (success or failure)
  - Cleanup, notifications
- [ ] **Workflow Hooks**: Add `onSleep`, `onComplete`, `onError` handlers

---

## Priority 5: Schema & Validation 📋

Type safety and validation improvements.

### Input/Output Validation
- [ ] **Schema Validation**: Implement schema validation for workflow and task payloads
  - Support Zod, JSON Schema, or TypeBox
  - Runtime validation at workflow/task boundaries
- [ ] **Enhanced Type Safety**: Comprehensive TypeScript type checking for payloads and results

---

## Priority 6: Security & Data Protection 🔒

Security features for sensitive workflows.

### Encryption
- [ ] **Payload Encryption**: Optional encryption of task/workflow payloads and results
  - At-rest encryption in storage
- [ ] **Secret Management**: Support for user-provided encryption keys
  - Key rotation support

### Idempotency
- [ ] **Enhanced Idempotency**: Improve idempotency key handling and validation
  - Conflict detection
  - Idempotency guarantees across retries

---

## Priority 7: Performance & Optimization ⚡

Performance improvements for high-scale deployments.

### Storage & Persistence
- [ ] **Enhanced Storage**: Improve workflow run result persistence
  - Compression for large payloads
  - Archival for old runs
- [ ] **Audit Trail**: Better tracking of workflow execution history
  - Immutable event log
  - Compliance tracking

### Performance
- [ ] **Optimization**: Performance improvements for high-throughput scenarios
  - Batch operations
  - Connection pooling
- [ ] **Caching**: Implement intelligent caching for frequently accessed data
  - Workflow definition caching
  - Result caching

---

## Priority 8: Research & Exploration 🔬

Exploratory work for future capabilities.

### Advanced Patterns
- [ ] **Event Sourcing**: Explore event sourcing patterns for workflow state
  - Full state reconstruction
  - Time travel debugging

### Integration
- [ ] **External Systems**: Better integration with external services and APIs
  - Pre-built connectors
  - Webhook management
- [ ] **Monitoring**: Enhanced monitoring and observability features
  - Metrics export (Prometheus)
  - Distributed tracing (OpenTelemetry)

---

## Code Quality 🧹

### Linting & Standards
- [ ] **Linting Rules**: Add `no-return-await` lint rule
- [ ] **Code Cleanup**: Remove completed TODOs
  - `sdk/worker/worker.ts:359` - Remove fallback TODO comment

---

## Notes

- Task cancellation is implemented by updating task status in storage rather than interrupting running tasks
- Workers check cancellation status before updating storage with results
- Focus on maintaining backward compatibility during feature additions
- Redis Streams will be the primary/only subscriber strategy going forward
