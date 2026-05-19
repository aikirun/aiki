import type { Equal, ExpectFalse, ExpectTrue } from "../testing/expect/types";

export type NonEmptyArray<T> = [T, ...T[]];
declare const _nonEmptyArrayTypeTests: [
	ExpectTrue<Equal<NonEmptyArray<number>, [number, ...number[]]>>,
	ExpectFalse<Equal<NonEmptyArray<number>, []>>,
	ExpectFalse<Equal<NonEmptyArray<number>, [number]>>,
	ExpectFalse<Equal<NonEmptyArray<number>, number[]>>,
];
