# @aikirun/workflow

Workflow SDK for Aiki durable execution platform.

## Installation

```bash
npm install @aikirun/workflow
```

## Quick Start

```typescript
import { workflow } from "@aikirun/workflow";
import { sendEmail, createProfile } from "./tasks.ts";

// Define a workflow
export const onboardingWorkflow = workflow({ name: "user-onboarding" });

export const onboardingWorkflowV1 = onboardingWorkflow.v("1.0.0", {
	async handler(run, input: { email: string }) {
		await sendEmail.start(run, { email: input.email });
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
	redis: { host: "localhost", port: 6379 },
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
	name: "daily-report",
	type: "cron",
	expression: "0 9 * * *", // Every day at 9 AM
});

await dailyReport.activate(aikiClient, onboardingWorkflowV1, { email: "daily@example.com" });
```

## Features

- **Durable Execution** - Workflows survive crashes and restarts
- **Task Orchestration** - Coordinate multiple tasks
- **Durable Sleep** - Sleep without blocking workers
- **Event Handling** - Wait for external events with timeouts
- **Child Workflows** - Compose workflows together
- **Automatic Retries** - Configurable retry strategies
- **Versioning** - Run multiple versions simultaneously
- **Scheduling** - Trigger workflows on cron or interval schedules

## Documentation

For comprehensive documentation including retry strategies, schema validation, child workflows, and best practices, see the [Workflows Guide](https://github.com/aikirun/aiki/blob/main/docs/core-concepts/workflows.md).

## Related Packages

- [@aikirun/task](https://www.npmjs.com/package/@aikirun/task) - Define tasks
- [@aikirun/client](https://www.npmjs.com/package/@aikirun/client) - Start workflows
- [@aikirun/worker](https://www.npmjs.com/package/@aikirun/worker) - Execute workflows

## License

Apache-2.0
