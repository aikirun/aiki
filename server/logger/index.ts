import pino from "pino";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type LogLevel = (typeof logLevels)[number];

function getLogLevel(): LogLevel {
	const logLevel = process.env.LOG_LEVEL?.toLowerCase();
	return logLevels.includes(logLevel as LogLevel) ? (logLevel as LogLevel) : "info";
}

export const logger = pino({
	level: getLogLevel(),
	formatters: {
		level: (label) => ({ level: label }),
	},
	transport:
		process.env.NODE_ENV !== "production"
			? {
					target: "pino-pretty",
					options: {
						colorize: true,
						ignore: "pid,hostname",
						translateTime: "yyyy-mm-dd HH:MM:ss",
						singleLine: false,
					},
				}
			: undefined,
});

export type Logger = typeof logger;
