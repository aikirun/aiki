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



## We might also add task dependencies

### Also, to solve the problem about workflow version specific versioning,
we might update the workflowregistry add to accept workflow version not workflow


#### Add logger to client and use internally in SDK
export interface Logger {
    trace(message: string, metadata?: Record<string, unknown>): void;
    debug(message: string, metadata?: Record<string, unknown>): void;
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
    child(metadata: Record<string, unknown>): Logger;
  }

If the app happens to use a logger that accepts other params, they can use a closure e.g
const getLogger = (ctx) => ({
    info(message, meta) => logger.info(ctx, message, meta),
    child(meta) => logger
});

const client = new Client({
    baseUrl: "http://localhost:3000",
    logger: pino({ level: 'info' }), // Optional, defaults to console
  });

  class ClientImpl implements Client {
    private logger: Logger;

    constructor(private readonly params: ClientParams) {
      this.logger = params.logger ?? new ConsoleLogger();

      this.rpcClient = new RpcClient({
        baseUrl: params.baseUrl,
        timeout: 30000,
        logger: this.logger.child({ component: "rpc" }),
      });
    }

    public _internal = {
      getLogger: () => this.logger,
      // ... other internal methods
    };
  }

  class WorkerImpl implements Worker {
    private logger: Logger;

    constructor(
      private readonly client: Client,
      private readonly params: WorkerParams,
    ) {
      // Get logger from client and create worker-specific child
      this.logger = client._internal.getLogger().child({
        component: "worker",
        workerId: this.id,
      });
    }

    private async executeWorkflow(
      workflowRunRow: WorkflowRunRow<unknown, unknown>,
      workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
    ): Promise<void> {
      const workflowRun = await initWorkflowRun(
        this.client.workflowRun,
        workflowRunRow
      );

      // Create workflow-specific logger
      const workflowLogger = this.logger.child({
        workflowName: workflowRunRow.name,
        workflowVersionId: workflowRunRow.versionId,
        workflowRunId: workflowRunRow.id,
      });

      const dependencies = this.workflowRegistry._internal.getDependencies(
        workflowRunRow.name,
        workflowRunRow.versionId
      );

      await workflowVersion._execute(
        { workflowRun, log: workflowLogger }, // Pass logger in context
        workflowRunRow.params.payload,
        dependencies
      );
    }
  }


   export interface WorkflowRunContext<Payload, Result> {
    workflowRun: Omit<WorkflowRun<Payload, Result>, "params">;
    log: Logger; // Workflow-specific logger with automatic context
  }

### Update function run to be exec. Also exec type should be 

type ExecFunction<Payload, Result, Deps = void, Ctx = void> =
    Ctx extends void
      ? Deps extends void
        ? (run: Run, payload: Payload) => Promise<Result>
        : (run: Run, payload: Payload, deps: Deps) => Promise<Result>
      : Deps extends void
        ? (run: Run, payload: Payload, ctx: Ctx) => Promise<Result>
        : (run: Run, payload: Payload, deps: Deps, ctx: Ctx) => Promise<Result>;

actually, the above is wrong, we should place xtx before deps
exec: async (run, payload, ctx, deps) => Result


Then we can rename ctx to run


### Add create ctx to worker 
// 3. Worker with context factory
  const worker = await worker(client, {
    createContext: (workflowRun) => ({
      requestId: workflowRun.id,
      userId: workflowRun.params.payload.userId,
      tenantId: workflowRun.params.payload.tenantId,
    })
  });

  OR maybe add it to workflow level? for better type safety.

  Actually, we should support both!

  ### workflow, task etc should be independently installable packages

  ### don't for get to bind(this)

  ### switch payload and runCtx order