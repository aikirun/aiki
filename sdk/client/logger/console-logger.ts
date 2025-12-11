import type { Logger } from "@aikirun/types/client";

export class ConsoleLogger implements Logger {
	constructor(private readonly context: Record<string, unknown> = {}) {}

	trace(message: string, metadata?: Record<string, unknown>): void {
		// biome-ignore lint/suspicious/noConsole: <explanation>
		console.debug(this.format("TRACE", message, metadata));
	}

	debug(message: string, metadata?: Record<string, unknown>): void {
		// biome-ignore lint/suspicious/noConsole: <explanation>
		console.debug(this.format("DEBUG", message, metadata));
	}

	info(message: string, metadata?: Record<string, unknown>): void {
		// biome-ignore lint/suspicious/noConsole: <explanation>
		console.info(this.format("INFO", message, metadata));
	}

	warn(message: string, metadata?: Record<string, unknown>): void {
		// biome-ignore lint/suspicious/noConsole: <explanation>
		console.warn(this.format("WARN", message, metadata));
	}

	error(message: string, metadata?: Record<string, unknown>): void {
		// biome-ignore lint/suspicious/noConsole: <explanation>
		console.error(this.format("ERROR", message, metadata));
	}

	child(bindings: Record<string, unknown>): Logger {
		return new ConsoleLogger({ ...this.context, ...bindings });
	}

	private format(level: string, message: string, metadata?: Record<string, unknown>): string {
		const timestamp = new Date().toISOString();
		const mergedContext = { ...this.context, ...metadata };
		const contextStr = Object.keys(mergedContext).length > 0 ? ` ${JSON.stringify(mergedContext)}` : "";
		return `[${timestamp}] ${level}: ${message}${contextStr}`;
	}
}
