# Aiki TODO

This document tracks planned features and improvements for the Aiki durable workflow engine.

## Core Features

### Workflow Orchestration
- [ ] **Sub-workflows**: Enable workflows to trigger and orchestrate other workflows
- [ ] **Workflow Scheduling**: Add cron-based and time-based workflow scheduling
- [ ] **Workflow Cancellation**: Allow cancellation of workflows and tasks in progress
- [ ] **Workflow Timeouts**: Add maximum execution time limits for workflows

### Schema Validation
- [ ] **Input/Output Validation**: Implement schema validation for workflow and task payloads using common schema formats
- [ ] **Type Safety**: Add comprehensive TypeScript type checking for payloads and results

### Task Management
- [ ] **Task Cancellation**: Implement graceful task cancellation with status checking
- [ ] **Task Dependencies**: Add support for task dependencies and conditional execution
- [ ] **Task Timeouts**: Add per-task timeout configuration

## Workflow Lifecycle Hooks

### Pre/Post Execution
- [ ] **Pre-workflow Tasks**: Tasks that run exactly once before workflow execution starts
- [ ] **Post-workflow Tasks**: Tasks that run when workflow completes (success or failure)
- [ ] **Workflow Hooks**: Add `onSleep`, `onComplete`, `onError` handlers

### Execution Control
- [ ] **Block Until Complete**: Add method to wait for workflow completion
- [ ] **Workflow Pausing**: Support for pausing workflows mid-execution
- [ ] **Webhook Integration**: Pause workflow execution until external webhook is called

## Worker Management

### Worker Coordination
- [ ] **Work Stealing**: Allow workers to claim workflows from other workers
- [ ] **Task Reassignment**: Automatically reassign tasks to workers with appropriate handlers
- [ ] **Adaptive Polling**: Implement intelligent polling based on workload
- [ ] **Heartbeat Monitoring**: Detect and handle workers that haven't sent heartbeats

### Worker Deployment
- [ ] **Lambda Support**: Explore using AWS Lambda as workers with webhook triggers
- [ ] **Multi-runtime Support**: Abstract Deno-specific features to support Node.js and other runtimes

## Security & Data Protection

### Encryption
- [ ] **Payload Encryption**: Optional encryption of task/workflow payloads and results
- [ ] **Secret Management**: Support for user-provided encryption keys

### Idempotency
- [ ] **Enhanced Idempotency**: Improve idempotency key handling and validation

## Developer Experience

### API Improvements
- [ ] **Enhanced Workflow Status**: Provide detailed view of tasks executed within a workflow
- [ ] **Better Error Handling**: Improve error messages, types and debugging information
- [ ] **Payload Clarity**: Clarify payload source (static, dynamic, or templated) in documentation

### Code Quality
- [ ] **Linting Rules**: Add `no-return-await` lint rule
- [ ] **Branded Types**: Use branded types for IDs to improve type safety
- [ ] **Documentation**: Improve API documentation and examples

## Architecture Improvements

### Storage & Persistence
- [ ] **Enhanced Storage**: Improve workflow run result persistence
- [ ] **Audit Trail**: Better tracking of workflow execution history

### Performance
- [ ] **Optimization**: Performance improvements for high-throughput scenarios
- [ ] **Caching**: Implement intelligent caching for frequently accessed data

## Research & Exploration

### Advanced Features
- [ ] **Event Sourcing**: Explore event sourcing patterns for workflow state
- [ ] **Saga Pattern**: Research integration with saga pattern for distributed transactions
- [ ] **Machine Learning**: Investigate ML-based workflow optimization

### Integration
- [ ] **External Systems**: Better integration with external services and APIs
- [ ] **Monitoring**: Enhanced monitoring and observability features

---

## Notes

- Task cancellation is implemented by updating task status in storage rather than interrupting running tasks
- Workers check cancellation status before updating storage with results
- Consider using webhooks for serverless worker deployments
- Focus on maintaining backward compatibility during feature additions

  ### workflow, task etc should be independently installable packages