// biome-ignore-all lint/suspicious/noConsole: this is a console logger
// biome-ignore-all lint/style/useNamingConvention: upper case for log levels
import type { Logger } from "@aikirun/types/client";

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

const colors = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	gray: "\x1b[90m",
	blue: "\x1b[94m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
} as const;

const logLevelConfig: Record<LogLevel, { level: number; color: string }> = {
	TRACE: { level: 10, color: colors.gray },
	DEBUG: { level: 20, color: colors.blue },
	INFO: { level: 30, color: colors.green },
	WARN: { level: 40, color: colors.yellow },
	ERROR: { level: 50, color: colors.red },
};

interface ConsoleLoggerOptions {
	level?: LogLevel;
	context?: Record<string, unknown>;
}

export class ConsoleLogger implements Logger {
	private readonly level: number;
	private readonly context: Record<string, unknown>;

	constructor(options: ConsoleLoggerOptions = {}) {
		this.level = logLevelConfig[options.level ?? "INFO"].level;
		this.context = options.context ?? {};
	}

	trace(message: string, metadata?: Record<string, unknown>): void {
		if (this.level <= logLevelConfig.TRACE.level) {
			console.debug(this.format("TRACE", message, metadata));
		}
	}

	debug(message: string, metadata?: Record<string, unknown>): void {
		if (this.level <= logLevelConfig.DEBUG.level) {
			console.debug(this.format("DEBUG", message, metadata));
		}
	}

	info(message: string, metadata?: Record<string, unknown>): void {
		if (this.level <= logLevelConfig.INFO.level) {
			console.info(this.format("INFO", message, metadata));
		}
	}

	warn(message: string, metadata?: Record<string, unknown>): void {
		if (this.level <= logLevelConfig.WARN.level) {
			console.warn(this.format("WARN", message, metadata));
		}
	}

	error(message: string, metadata?: Record<string, unknown>): void {
		if (this.level <= logLevelConfig.ERROR.level) {
			console.error(this.format("ERROR", message, metadata));
		}
	}

	child(bindings: Record<string, unknown>): Logger {
		return new ConsoleLogger({
			level: Object.entries(logLevelConfig).find(([, v]) => v.level === this.level)?.[0] as LogLevel,
			context: { ...this.context, ...bindings },
		});
	}

	private format(level: LogLevel, message: string, metadata?: Record<string, unknown>): string {
		const timestamp = new Date().toISOString();
		const mergedContext = { ...this.context, ...metadata };
		const levelColor = logLevelConfig[level].color ?? colors.reset;

		const timestampStr = `${colors.dim}${timestamp}${colors.reset}`;
		const levelStr = `${levelColor}${colors.bold}${level.padEnd(5)}${colors.reset}`;
		const messageStr = `${colors.cyan}${message}${colors.reset}`;

		let output = `${timestampStr} ${levelStr} ${messageStr}`;

		if (Object.keys(mergedContext).length > 0) {
			const entries = Object.entries(mergedContext)
				.map(([key, value]) => {
					const valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);
					return `${colors.magenta}${key}:${colors.reset} ${valueStr}`;
				})
				.join("\n  ");
			output += `\n  ${entries}`;
		}

		return output;
	}
}
