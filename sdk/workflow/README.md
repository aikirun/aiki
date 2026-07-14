# @aikirun/workflow

Define durable workflows and tasks as plain TypeScript — versioned, retried, and resumable across crashes.

## Installation

```bash
npm install @aikirun/workflow
```

## Quick Start

```typescript
import { task, workflow } from "@aikirun/workflow";

const sendEmail = task({
	name: "send-email",
	async handler(input: { email: string; message: string }) {
		return emailService.send(input.email, input.message);
	},
});

export const onboardingWorkflow = workflow({ name: "user-onboarding" });

export const onboardingWorkflowV1 = onboardingWorkflow.v("1.0.0", {
	async handler(run, input: { email: string }) {
		await sendEmail.start(run, { email: input.email, message: "Welcome!" });
		await run.sleep("welcome-delay", { days: 1 });
		return { success: true };
	},
});
```

## Documentation

See the [Workflows Guide](https://aiki.run/docs/core-concepts/workflows) and the [Tasks Guide](https://aiki.run/docs/core-concepts/tasks).

## License

Apache-2.0
