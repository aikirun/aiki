import pino from "pino";
import pretty from "pino-pretty";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof logLevels)[number];

export function createLogger(logLevel: LogLevel, prettyLogs: boolean) {
	const baseOptions: pino.LoggerOptions = {
		level: logLevel,
		formatters: {
			level: (label) => ({ level: label }),
		},
	};

	if (prettyLogs) {
		return pino(
			baseOptions,
			pretty({
				colorize: true,
				ignore: "pid,hostname",
				translateTime: "yyyy-mm-dd HH:MM:ss",
				singleLine: false,
			})
		);
	}

	return pino(baseOptions);
}

export type Logger = ReturnType<typeof createLogger>;
