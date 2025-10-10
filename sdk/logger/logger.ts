export interface Logger {
	info(message: string, metadata?: Record<string, unknown>): void;
	debug(message: string, metadata?: Record<string, unknown>): void;
	warn(message: string, metadata?: Record<string, unknown>): void;
	error(message: string, metadata?: Record<string, unknown>): void;
	trace(message: string, metadata?: Record<string, unknown>): void;
	child?(bindings: Record<string, unknown>): Logger;
}

export function getChildLogger(
	logger: Logger,
	bindings: Record<string, unknown>,
): Logger {
	if (logger.child) {
		return logger.child(bindings);
	}

	return {
		info: (message, metadata) => logger.info(message, { ...bindings, ...metadata }),
		debug: (message, metadata) => logger.debug(message, { ...bindings, ...metadata }),
		warn: (message, metadata) => logger.warn(message, { ...bindings, ...metadata }),
		error: (message, metadata) => logger.error(message, { ...bindings, ...metadata }),
		trace: (message, metadata) => logger.trace(message, { ...bindings, ...metadata }),
		child: (childBindings) => getChildLogger(logger, { ...bindings, ...childBindings }),
	};
}
