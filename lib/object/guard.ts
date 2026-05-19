import type { RequiredNonNullableProp, RequiredProp } from "./types";
import type { NonEmptyArray } from "../array";

export function propsDefined<T, K extends keyof T>(obj: T, ...props: NonEmptyArray<K>): obj is RequiredProp<T, K> {
	return props.every((prop) => obj[prop] !== undefined);
}

export function propsRequiredNonNull<T, K extends keyof T>(
	obj: T,
	...props: NonEmptyArray<K>
): obj is RequiredNonNullableProp<T, K> {
	return props.every((prop) => {
		const value = obj[prop];
		return value !== undefined && value !== null;
	});
}
