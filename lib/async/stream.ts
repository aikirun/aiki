import { isNonEmptyArray, type NonEmptyArray } from "../array";

export async function* streamChunks<T>(
	next: () => T[] | Promise<T[]>,
	until?: (chunk: NonEmptyArray<T>) => boolean
): AsyncGenerator<NonEmptyArray<T>> {
	while (true) {
		const response = next();
		const chunk = response instanceof Promise ? await response : response;
		if (!isNonEmptyArray(chunk)) {
			return;
		}
		yield chunk;
		if (until?.(chunk)) {
			return;
		}
	}
}
