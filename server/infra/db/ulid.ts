import { monotonicFactory, ulid } from "ulidx";

export const generateUlid = (): string => ulid();

export const generateMonotonicUlid = (() => {
	const monotonic = monotonicFactory();
	return (): string => monotonic();
})();
