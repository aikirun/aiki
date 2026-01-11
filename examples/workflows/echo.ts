import { event, workflow } from "@aikirun/workflow";

export const echoV1 = workflow({ name: "echo" }).v("1.0.0", {
	async handler(run) {
		while (true) {
			const response = await run.events.ping.wait({ timeout: { seconds: 10 } });
			if (response.timeout) {
				run.logger.info("Timeout");
				break;
			}
			run.logger.info(response.data.message);
		}
	},
	events: {
		ping: event<{ message: string }>(),
	},
});
