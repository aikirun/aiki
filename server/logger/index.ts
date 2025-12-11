import pino from "pino";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof logLevels)[number];

export function createLogger(logLevel: LogLevel) {
	return pino({
		level: logLevel,
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
}

export type Logger = ReturnType<typeof createLogger>;
