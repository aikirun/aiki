import type { ProcessWrapper } from "./api.ts";

export const processWrapper: ProcessWrapper = {
	addSignalListener(signal: string, handler: () => void): void {
		Deno.addSignalListener(signal as Deno.Signal, handler);
	},

	exit(code: number): never {
		Deno.exit(code);
	},
};
