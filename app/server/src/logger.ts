import type { Logger } from "@aikirun/lib/logger";
import pino from "pino";
import pretty from "pino-pretty";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof logLevels)[number];

export function createLogger(logLevel: LogLevel, prettyLogs: boolean): Logger {
	const baseOptions: pino.LoggerOptions = {
		level: logLevel,
		formatters: {
			level: (label) => ({ level: label }),
		},
	};

	const pinoLogger = prettyLogs
		? pino(
				baseOptions,
				pretty({
					colorize: true,
					ignore: "pid,hostname",
					translateTime: "yyyy-mm-dd HH:MM:ss",
					singleLine: false,
				})
			)
		: pino(baseOptions);

	return adaptPino(pinoLogger);
}

const adaptPino = (pinoLogger: pino.Logger): Logger => ({
	trace: (message, metadata) => pinoLogger.trace(metadata ?? {}, message),
	debug: (message, metadata) => pinoLogger.debug(metadata ?? {}, message),
	info: (message, metadata) => pinoLogger.info(metadata ?? {}, message),
	warn: (message, metadata) => pinoLogger.warn(metadata ?? {}, message),
	error: (message, metadata) => pinoLogger.error(metadata ?? {}, message),
	child: (bindings) => adaptPino(pinoLogger.child(bindings)),
});
