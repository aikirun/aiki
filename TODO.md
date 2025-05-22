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


add ability to cancel tasks/workflows that are already in progress
an idea for doing this is to simply update the task status in storage
the running task isn't really cancelled, instead it runs as is.
When this running task completes, before updating the storage with the result, it checks if the 
task state is not in cancelled.

* throw types errors

* add a block until done method to a workflow, or rather an an onComplete method to the workflowrun that only resolves when the workflow truly completes.


// possibly encrypt task/workflow payload and result with a secret key provided by the sdk user. Should be optional.


idempotency key for when starting workflow

add no return await es lint rule


* is it possible to use lambdas as workers, possibly giving a web_hook to trigger

* payload wasn't initially intuitive, when creating a task, is the payload static or from aiki or a template

* enhance workflow run handler to return more info e.g. give me a view of the tasks that have been run by this workflow

* wait for webhook. Pause till the provided url is called

add a means for workers to claim workflows from othere workers.
This should also help re-assign tasks to the workflow which has a handler for that task.