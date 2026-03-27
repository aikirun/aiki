import { event, task, workflow } from "@aikirun/workflow";

/**
 * CAM Divergence Test Workflows
 *
 * Each workflow reads a mutable flag (uncaptured dependency) to decide its code path.
 * The scenario script starts the workflow (flag off), waits for it to suspend at an
 * event wait, flips the flag, then sends the event. On replay, the workflow reads the
 * flipped flag and takes a different branch — testing CAM's divergence detection.
 */

export const flags = {
	reorder: false,
	removal: false,
	append: false,
	insert: false,
	inputChange: false,
	controlFlow: false,
};

const taskA = task({
	name: "cam-a",
	async handler() {
		return { a: 1 };
	},
});
const taskB = task({
	name: "cam-b",
	async handler() {
		return { b: 2 };
	},
});
const taskC = task({
	name: "cam-c",
	async handler() {
		return { c: 3 };
	},
});
const taskD = task({
	name: "cam-d",
	async handler() {
		return { d: 4 };
	},
});

const taskWithInput = task({
	name: "cam-input",
	async handler(input: { id: string }) {
		return { id: input.id };
	},
});

// Safe: same tasks consumed in different order
export const camReorderV1 = workflow({ name: "cam-reorder" }).v("1.0.0", {
	async handler(run) {
		if (flags.reorder) {
			await taskB.start(run);
			await taskA.start(run);
		} else {
			await taskA.start(run);
			await taskB.start(run);
		}
		await run.events.proceed.wait();
		return { ok: true };
	},
	events: { proceed: event() },
});

// Safe: fewer entries consumed, nothing new executed
export const camRemovalV1 = workflow({ name: "cam-removal" }).v("1.0.0", {
	async handler(run) {
		if (!flags.removal) {
			await taskA.start(run);
		}
		await taskB.start(run);
		await run.events.proceed.wait();
		return { ok: true };
	},
	events: { proceed: event() },
});

// Safe: new task after all previous entries consumed
export const camAppendV1 = workflow({ name: "cam-append" }).v("1.0.0", {
	async handler(run) {
		await taskA.start(run);
		await run.events.proceed.wait();
		if (flags.append) {
			await taskB.start(run);
		}
		return { ok: true };
	},
	events: { proceed: event() },
});

// Unsafe: new task before unconsumed entries → NDE
export const camInsertV1 = workflow({ name: "cam-insert" }).v("1.0.0", {
	async handler(run) {
		await taskA.start(run);
		if (flags.insert) {
			await taskC.start(run);
		}
		await taskB.start(run);
		await run.events.proceed.wait();
		return { ok: true };
	},
	events: { proceed: event() },
});

// Unsafe: different input → different address, old entry unconsumed → NDE
export const camInputChangeV1 = workflow({ name: "cam-input-change" }).v("1.0.0", {
	async handler(run) {
		await taskWithInput.start(run, { id: flags.inputChange ? "changed" : "original" });
		await run.events.proceed.wait();
		return { ok: true };
	},
	events: { proceed: event() },
});

// Unsafe: entirely different branch, old entries unconsumed → NDE
export const camControlFlowV1 = workflow({ name: "cam-control-flow" }).v("1.0.0", {
	async handler(run) {
		if (flags.controlFlow) {
			await taskC.start(run);
			await taskD.start(run);
		} else {
			await taskA.start(run);
			await taskB.start(run);
		}
		await run.events.proceed.wait();
		return { ok: true };
	},
	events: { proceed: event() },
});
