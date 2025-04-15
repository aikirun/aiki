workflows should be able to kick off sub workflows

add input and out schema validation. Use common schema

// interface Organization {
//     id: number;
//     name: string;
// }

// interface Workspace {
//     id: number;
//     name: string;
//     organization_id: number;
// }

Add scheduling of workflow
// export type X =
    | { type: "cron"; expression: string };

export type WorkflowScheduleParams<Payload> = UndefinedToPartial<{
	payload: Payload;
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
}>;

// schedule: (params: WorkflowScheduleParams<Payload>) => Promise<WorkflowRun<Payload, Result>>;

// add max execution ts


// TODO:
	// possibly allow passing publish handler to submit workflow updates
	// why not just write it in the workflow?

	// task to perofrm on workflow completion?
	// write in workflow?

	// task to perform before workflow starts?
	// performed exactly once per workflow run

	// task to perform before each workflow start?
	// performed more than once

	// add handler for onSleep, onComplete