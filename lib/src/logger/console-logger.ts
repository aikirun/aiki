import type { Logger, LogLevel } from "./types";
import { describeErrorCauses } from "../error/cause";

const logLevelConfig: Record<LogLevel, { level: number }> = {
	trace: { level: 10 },
	debug: { level: 20 },
	info: { level: 30 },
	warn: { level: 40 },
	error: { level: 50 },
};

export interface ConsoleLoggerOptions {
	/** The lowest level that is printed (default: "info"). */
	level?: LogLevel;
	/**
	 * Print each entry as plain text for a person to read, with its metadata on the lines below,
	 * instead of as one JSON line (default: false).
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
		const levelStr = logLevel.toUpperCase().padEnd(5);

		let output = `${timestamp} ${levelStr} ${message}`;

		if (Object.keys(mergedMetadata).length > 0) {
			const entries = Object.entries(mergedMetadata)
				.map(([key, value]) => {
					// Error properties are non-enumerable, so JSON.stringify renders the error as "{}".
					if (value instanceof Error) {
						const causes = describeErrorCauses(value)
							.map((cause) => `\n  Caused by: ${cause}`)
							.join("");
						return `${key}: ${value.stack ?? `${value.name}: ${value.message}`}${causes}`;
					}
					const valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);
					return `${key}: ${valueStr}`;
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
