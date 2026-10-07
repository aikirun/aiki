import type { Logger, LogLevel } from "./types";
import { describeErrorCauses } from "../error/cause";

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
	trace: { level: 10, color: colors.gray },
	debug: { level: 20, color: colors.blue },
	info: { level: 30, color: colors.green },
	warn: { level: 40, color: colors.yellow },
	error: { level: 50, color: colors.red },
};

export interface ConsoleLoggerOptions {
	/** The lowest level that is printed (default: "info"). */
	level?: LogLevel;
	/**
	 * Print coloured, multi-line entries for reading in a terminal, instead of one JSON line per
	 * entry (default: false).
	 */
	pretty?: boolean;
}

export function consoleLogger(options: ConsoleLoggerOptions = {}): Logger {
	return consoleLoggerWithBindings({
		level: options.level ?? "info",
		pretty: options.pretty ?? false,
		bindings: {},
	});
}

function consoleLoggerWithBindings(params: {
	level: LogLevel;
	pretty: boolean;
	bindings: Record<string, unknown>;
}): Logger {
	const { pretty, bindings } = params;
	const level = logLevelConfig[params.level].level;

	function format(logLevel: LogLevel, message: string, metadata?: Record<string, unknown>): string {
		const mergedMetadata = { ...bindings, ...metadata };

		if (!pretty) {
			const entry: Record<string, unknown> = { level: logLevel, time: Date.now() };
			for (const [key, value] of Object.entries(mergedMetadata)) {
				// Error properties are non-enumerable, so JSON.stringify renders the error as "{}".
				entry[key] =
					value instanceof Error
						? { name: value.name, message: value.message, stack: value.stack, causes: describeErrorCauses(value) }
						: value;
			}
			entry.msg = message;
			return JSON.stringify(entry);
		}

		const timestamp = new Date().toISOString();
		const levelColor = logLevelConfig[logLevel].color ?? colors.reset;

		const timestampStr = `${colors.dim}${timestamp}${colors.reset}`;
		const levelStr = `${levelColor}${colors.bold}${logLevel.toUpperCase().padEnd(5)}${colors.reset}`;
		const messageStr = `${colors.cyan}${message}${colors.reset}`;

		let output = `${timestampStr} ${levelStr} ${messageStr}`;

		if (Object.keys(mergedMetadata).length > 0) {
			const entries = Object.entries(mergedMetadata)
				.map(([key, value]) => {
					// Error properties are non-enumerable, so JSON.stringify renders the error as "{}".
					if (value instanceof Error) {
						const causes = describeErrorCauses(value)
							.map((cause) => `\n  ${colors.magenta}Caused by:${colors.reset} ${cause}`)
							.join("");
						return `${colors.magenta}${key}:${colors.reset} ${value.stack ?? `${value.name}: ${value.message}`}${causes}`;
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
			if (level <= logLevelConfig.trace.level) {
				console.debug(format("trace", message, metadata));
			}
		},
		debug(message, metadata) {
			if (level <= logLevelConfig.debug.level) {
				console.debug(format("debug", message, metadata));
			}
		},
		info(message, metadata) {
			if (level <= logLevelConfig.info.level) {
				console.info(format("info", message, metadata));
			}
		},
		warn(message, metadata) {
			if (level <= logLevelConfig.warn.level) {
				console.warn(format("warn", message, metadata));
			}
		},
		error(message, metadata) {
			if (level <= logLevelConfig.error.level) {
				console.error(format("error", message, metadata));
			}
		},
		child(childBindings) {
			return consoleLoggerWithBindings({
				level: params.level,
				pretty,
				bindings: { ...bindings, ...childBindings },
			});
		},
	};
}
