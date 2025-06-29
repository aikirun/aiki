import type { ProcessWrapper } from "./api.ts";

// deno-lint-ignore-file no-process-global
declare const process: {
	on(signal: string, handler: () => void): void;
	exit(code: number): never;
};

export const processWrapper: ProcessWrapper = {
	addSignalListener(signal: string, handler: () => void): void {
		process.on(signal, handler);
	},

	exit(code: number): never {
		process.exit(code);
	},
};
