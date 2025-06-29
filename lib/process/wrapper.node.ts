import type { ProcessWrapper } from "./api.ts";

export const processWrapper: ProcessWrapper = {
	addSignalListener(signal: string, handler: () => void): void {
		process.on(signal, handler);
	},

	exit(code: number): never {
		process.exit(code);
	},
};
