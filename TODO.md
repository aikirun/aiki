# Aiki TODO

This document tracks planned features and improvements for the Aiki durable workflow engine.

## Priority 0: Production Blockers 🚨

These items block production adoption and must be implemented first.

### Task Reliability
- [ ] **Task Retry Logic**: Implement automatic retry with exponential backoff for failed tasks
  - Currently TODO in `sdk/task/task.ts` (search for retry logic) - tasks fail permanently without retries
  - Need to track retry attempts, implement backoff delays, persist retry state
  - Critical for production reliability
- [ ] **Error Serialization**: Proper error capture with stack traces and context
  - Currently TODO in `sdk/task/task.ts` (search for error serialization) - errors cast to string without context
  - Need to serialize Error objects with message, stack, cause, name

### Workflow Results
- [ ] **Workflow Result Persistence**: Store and retrieve workflow execution results
  - Currently TODO in `sdk/workflow/version/workflow-version.ts` (search for result persistence)
  - Need server API endpoint and database schema for output storage
  - Required for `WorkflowRunResultHandle` to actually return results

### Type Safety
- [ ] **Task Result Type Validation**: Runtime validation of pre-existing task results
  - Currently TODO in `sdk/workflow/run/run-handle.ts` (search for type validation)
  - Add Zod schema validation or runtime type checks

---

## Priority 1: Core Features 🎯

Essential features for workflow orchestration.

### Workflow Primitives
- [ ] **Cron/Scheduled Workflows**: Add cron-based and time-based workflow scheduling
  - Support recurring schedules (cron expressions)
  - Support one-time delayed execution
  - Major blocker - most production use cases need scheduled workflows
- [ ] **Durable Sleep/Timers**: Add `run.sleep()` for durable delays
- [ ] **Workflow Timeouts**: Add maximum execution time limits for workflows
  - Prevent infinite loops and runaway workflows
- [ ] **Workflow Cancellation**: Allow cancellation of workflows and tasks in progress
  - Need graceful cancellation with cleanup handlers

### Event System (Redis Streams Based)
- [ ] **Event-Driven Triggers**: Enable workflows triggered by events
- [ ] **Signals for External Communication**: Send signals to running workflows
- [ ] **Eliminate Polling Strategies**: Remove polling and adaptive polling subscriber strategies
  - Keep only Redis Streams strategy
  - Reduces implementation complexity and maintenance burden
  - Simplifies deployment (only need Redis)

### Workflow Orchestration
- [ ] **Sub-workflows**: Enable workflows to trigger and orchestrate other workflows
  - Parent-child relationship tracking
  - Parallel sub-workflow execution

---

## Priority 2: Developer Experience 🛠️

Improvements to make Aiki easier to use and debug.

### CLI & Developer Tooling
- [ ] **Dev CLI**: Command-line tool for local development and workflow management
  - `aiki dev` - Start local development environment with hot reload
  - `aiki runs list` - List workflow runs
  - `aiki runs inspect <run-id>` - Inspect workflow execution details
  - `aiki workflows trigger <name>` - Trigger workflows from CLI
  - Local test mode without full server setup
  - Hot reload support for workflow/task code changes

### Testing & Debugging
- [ ] **Testing Utilities Package**: Add `@aiki/testing` for workflow testing e.g. mock tasks execution, time travel
- [ ] **Workflow History/Timeline**: Visualize workflow execution history
  - Show task execution order, durations, retries
  - Debug failed workflows
  - Export execution traces

### Observability
- [ ] **Web Dashboard**: Web UI for workflow monitoring
- [ ] **Enhanced Workflow Status**: Provide detailed view of tasks executed within a workflow
  - Real-time task completion tracking
  - Progress indicators
- [ ] **Better Error Handling**: Improve error messages, types and debugging information
  - Structured error types
  - Error codes and categories
  - Actionable error messages

### Documentation
- [ ] **Go-to-Market Documentation**: Strategic documentation for adoption
  - **Comparison Guides**: "Aiki vs Temporal"
    - When to choose each platform
    - Feature comparison matrices
    - Migration considerations
  - **Migration Guides**: "Migrating from BullMQ to Aiki", "Migrating from job queues"
    - Step-by-step migration paths
    - Code transformation examples
    - Common patterns translation
  - **Real-World Examples**: Production-ready workflow examples
    - E-commerce order processing workflow
    - Payment processing with retries and reconciliation
    - Multi-tenant SaaS workflows with isolation
    - User onboarding flows with delays and events
  - **Best Practices**: Workflow versioning strategies
    - When to create new versions vs update existing
    - Managing long-running workflow migrations
    - Testing versioned workflows
- [ ] **API Documentation**: Comprehensive API docs with examples
  - Getting started guide
  - API reference
  - Architecture deep-dives

---

## Priority 3: Package Architecture 📦

Modularization for better tree-shaking and deployment flexibility.

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
  - Support Zod
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

### Concurrency Control
- [ ] **Advanced Concurrency Control**: Workflow and task-specific limits
    Note: Worker-level concurrency (maxConcurrentWorkflowRuns) already exists.
    This item is about workflow limits.

    - Per-workflow concurrency limits
      - Limit max instances of a specific workflow across all workers
      - Use case: Video processing, resource-intensive workflows

    - Queue throttling
      - Limit workflow start rate at worker level
      - Use case: Prevent stampeding herd on system startup

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

### Compliance & Audit (Strategic Differentiator)
- [ ] **Built-in Compliance Features**: Compliance-ready features for regulated industries
  - **Audit Logging**: Automatic audit trail for all workflow executions
    - Who triggered workflow, when, with what input
    - All state changes and task executions
    - Immutable event log for compliance
  - **Data Retention Policies**: Configurable retention periods
    - Workflow-level retention configuration
    - Automatic archival of old runs
    - GDPR/compliance-friendly data lifecycle
  - **PII Field Marking**: Mark sensitive fields in workflows
    - Automatic encryption of PII fields
    - Redaction in logs and observability
    - Compliance reporting for data access

---

## Code Quality 🧹

### Linting & Standards
- [ ] **Code Cleanup**: Remove completed TODOs

---

## Notes

- Task cancellation is implemented by updating task status in storage rather than interrupting running tasks
- Workers check cancellation status before updating storage with results
