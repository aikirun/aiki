export function addSignalListener(signal: string, handler: () => void): void {
	if (typeof Deno !== "undefined") {
		Deno.addSignalListener(signal as Deno.Signal, handler);
		return;
	}
	// deno-lint-ignore no-process-global
	process.on(signal, handler);
}

export function exit(code: number): never {
	if (typeof Deno !== "undefined") {
		Deno.exit(code);
	}
	// deno-lint-ignore no-process-global
	process.exit(code);
} 