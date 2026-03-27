# @aikirun/workflow

Workflow and Task SDK for Aiki durable execution platform.

## Installation

```bash
npm install @aikirun/workflow
```

## Quick Start

```typescript
import { task, workflow } from "@aikirun/workflow";

// Define tasks
const sendEmail = task({
	name: "send-email",
	async handler(input: { email: string; message: string }) {
		return emailService.send(input.email, input.message);
	},
});

const createProfile = task({
	name: "create-profile",
	async handler(input: { email: string }) {
		return profileService.create(input.email);
	},
});

// Define a workflow
export const onboardingWorkflow = workflow({ name: "user-onboarding" });

export const onboardingWorkflowV1 = onboardingWorkflow.v("1.0.0", {
	async handler(run, input: { email: string }) {
		await sendEmail.start(run, { email: input.email, message: "Welcome!" });
		await run.sleep("welcome-delay", { days: 1 });
		await createProfile.start(run, { email: input.email });
		return { success: true };
	},
});
```

Run with a client:

```typescript
import { client } from "@aikirun/client";

const aikiClient = client({
	url: "http://localhost:9850",
	apiKey: "your-api-key",
});

const handle = await onboardingWorkflowV1.start(aikiClient, {
	email: "user@example.com",
});

const result = await handle.waitForStatus("completed");
```

## Scheduling

Run workflows on a schedule using cron expressions or intervals:

```typescript
import { schedule } from "@aikirun/workflow";

const dailyReport = schedule({
	type: "cron",
	expression: "0 9 * * *", // Every day at 9 AM
});

await dailyReport.activate(aikiClient, onboardingWorkflowV1, { email: "daily@example.com" });
```

## Features

- **Durable Execution** - Workflows survive crashes and restarts
- **Task Orchestration** - Coordinate multiple tasks
- **Schema Validation** - Validate workflow & task input and output at runtime
- **Durable Sleep** - Sleep without blocking workers
- **Event Handling** - Wait for external events with timeouts
- **Child Workflows** - Compose workflows together
- **Automatic Retries** - Configurable retry strategies
- **Versioning** - Run multiple versions simultaneously
- **Scheduling** - Trigger workflows on cron or interval schedules

## Documentation

For comprehensive documentation including retry strategies, schema validation, child workflows, and best practices, see the [Workflows Guide](https://github.com/aikirun/aiki/blob/main/docs/core-concepts/workflows.md) and [Tasks Guide](https://github.com/aikirun/aiki/blob/main/docs/core-concepts/tasks.md).

## Related Packages

- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Start workflows
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows

## License

Apache-2.0
