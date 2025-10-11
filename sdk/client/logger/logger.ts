import type { Logger } from "@aiki/types/client";

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
