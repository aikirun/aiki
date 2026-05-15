// biome-ignore-all lint/correctness/noUnusedVariables: the unused types are tests
import type { NonEmptyArray } from "@aikirun/types/array";

import type { Equal, ExpectFalse, ExpectTrue } from "../testing/expect/types";

export type { NonEmptyArray };

//#region <NonEmptyArray Tests>
type TestNonEmptyArrayShouldBeATupleOfOneOrMoreElements = ExpectTrue<
	Equal<NonEmptyArray<number>, [number, ...number[]]>
>;
type TestNonEmptyArrayIsNotEmptyTuple = ExpectFalse<Equal<NonEmptyArray<number>, []>>;
type TestNonEmptyArrayIsNotSingleItemTuple = ExpectFalse<Equal<NonEmptyArray<number>, [number]>>;
type TestNonEmptyArrayIsNotarray = ExpectFalse<Equal<NonEmptyArray<number>, number[]>>;
//#endregion
