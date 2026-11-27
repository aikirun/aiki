import { describe, expect, test } from "vitest";

import { toTaskState, toWorkflowRunState } from "./state-transition-row";

describe("toWorkflowRunState", () => {
	test("defaults definitionOutputCodecApplied to false when omitted on a completed state", () => {
		const state = toWorkflowRunState({ status: "completed", output: { ok: true } });

		expect(state).toEqual({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: false,
		});
	});

	test("preserves definitionOutputCodecApplied when present on a completed state", () => {
		const state = toWorkflowRunState({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: true,
		});

		expect(state).toEqual({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: true,
		});
	});

	test("restores missing output key as undefined on a completed state", () => {
		const state = toWorkflowRunState({
			status: "completed",
			definitionOutputCodecApplied: false,
		});

		expect("output" in state).toBe(true);
		expect(state).toEqual({
			status: "completed",
			output: undefined,
			definitionOutputCodecApplied: false,
		});
	});

	test("does not add completed-state defaults to non-completed states", () => {
		const state = toWorkflowRunState({ status: "running" });

		expect("output" in state).toBe(false);
		expect("definitionOutputCodecApplied" in state).toBe(false);
		expect(state).toEqual({ status: "running" });
	});
});

describe("toTaskState", () => {
	test("defaults definitionOutputCodecApplied to false when omitted on a completed state", () => {
		const state = toTaskState({ status: "completed", output: { ok: true } });

		expect(state).toEqual({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: false,
		});
	});

	test("preserves definitionOutputCodecApplied when present on a completed state", () => {
		const state = toTaskState({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: true,
		});

		expect(state).toEqual({
			status: "completed",
			output: { ok: true },
			definitionOutputCodecApplied: true,
		});
	});

	test("restores missing output key as undefined on a completed state", () => {
		const state = toTaskState({
			status: "completed",
			definitionOutputCodecApplied: false,
		});

		expect("output" in state).toBe(true);
		expect(state).toEqual({
			status: "completed",
			output: undefined,
			definitionOutputCodecApplied: false,
		});
	});

	test("does not add completed-state defaults to non-completed states", () => {
		const state = toTaskState({ status: "running" });

		expect("output" in state).toBe(false);
		expect("definitionOutputCodecApplied" in state).toBe(false);
		expect(state).toEqual({ status: "running" });
	});
});
