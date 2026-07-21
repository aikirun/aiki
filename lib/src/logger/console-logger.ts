import type { Logger, LogLevel } from "./types";

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
	bindings?: Record<string, unknown>;
}

export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
	const level = logLevelConfig[options.level ?? "INFO"].level;
	const bindings = options.bindings ?? {};

	function format(logLevel: LogLevel, message: string, metadata?: Record<string, unknown>): string {
		const timestamp = new Date().toISOString();
		const mergedMetadata = { ...bindings, ...metadata };
		const levelColor = logLevelConfig[logLevel].color ?? colors.reset;

		const timestampStr = `${colors.dim}${timestamp}${colors.reset}`;
		const levelStr = `${levelColor}${colors.bold}${logLevel.padEnd(5)}${colors.reset}`;
		const messageStr = `${colors.cyan}${message}${colors.reset}`;

		let output = `${timestampStr} ${levelStr} ${messageStr}`;

		if (Object.keys(mergedMetadata).length > 0) {
			const entries = Object.entries(mergedMetadata)
				.map(([key, value]) => {
					// Error properties are non-enumerable, so JSON.stringify renders the error as "{}".
					if (value instanceof Error) {
						return `${colors.magenta}${key}:${colors.reset} ${value.stack ?? `${value.name}: ${value.message}`}`;
					}
					const valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);
					return `${colors.magenta}${key}:${colors.reset} ${valueStr}`;
				})
				.join("\n  ");
			output += `\n  ${entries}`;
		}

		return output;
	}

	return {
		trace(message, metadata) {
			if (level <= logLevelConfig.TRACE.level) {
				console.debug(format("TRACE", message, metadata));
			}
		},
		debug(message, metadata) {
			if (level <= logLevelConfig.DEBUG.level) {
				console.debug(format("DEBUG", message, metadata));
			}
		},
		info(message, metadata) {
			if (level <= logLevelConfig.INFO.level) {
				console.info(format("INFO", message, metadata));
			}
		},
		warn(message, metadata) {
			if (level <= logLevelConfig.WARN.level) {
				console.warn(format("WARN", message, metadata));
			}
		},
		error(message, metadata) {
			if (level <= logLevelConfig.ERROR.level) {
				console.error(format("ERROR", message, metadata));
			}
		},
		child(childBindings) {
			return createConsoleLogger({
				level: Object.entries(logLevelConfig).find(([, v]) => v.level === level)?.[0] as LogLevel,
				bindings: { ...bindings, ...childBindings },
			});
		},
	};
}
