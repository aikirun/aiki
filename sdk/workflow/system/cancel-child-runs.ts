import { isNonEmptyArray } from "@aikirun/lib/array";
import type { ApiClient } from "@aikirun/types/client";
import { NON_TERMINAL_WORKFLOW_RUN_STATUSES } from "@aikirun/types/workflow-run";

import { task } from "../task";
import { workflow } from "../workflow";

export const createCancelChildRunsV1 = (api: ApiClient) => {
	const listNonTerminalChildRuns = task({
		name: "aiki:list-non-terminal-child-runs",
		async handler(parentRunId: string) {
			const { runs } = await api.workflowRun.listChildRunsV1({
				parentRunId,
				status: NON_TERMINAL_WORKFLOW_RUN_STATUSES,
			});
			return runs.map((r) => r.id);
		},
	});

	const cancelRuns = task({
		name: "aiki:cancel-runs",
		async handler(runIds: string[]) {
			const { cancelledIds } = await api.workflowRun.cancelByIdsV1({ ids: runIds });
			return cancelledIds;
		},
	});

	return workflow({ name: "aiki:cancel-child-runs" }).v("1.0.0", {
		async handler(run, parentRunId: string) {
			const childRunIds = await listNonTerminalChildRuns.start(run, parentRunId);
			if (!isNonEmptyArray(childRunIds)) {
				return;
			}
			await cancelRuns.start(run, childRunIds);
		},
	});
};
