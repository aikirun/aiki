// biome-ignore-all lint/correctness/noUnusedVariables: the unused types are tests
import type { RequireAtLeastOneProp } from "@aikirun/types/utils";

import type { NonEmptyArray } from "../array";
import type { Equal, ExpectTrue } from "../testing/expect/types";
export type { RequireAtLeastOneProp };

export type EmptyRecord = Record<PropertyKey, never>;

export type NonArrayObject<T> = T extends object ? (T extends ReadonlyArray<unknown> ? never : T) : never;
//#region <NonArrayObject Tests>
type TestNonArrayObjectPlainObject = ExpectTrue<Equal<NonArrayObject<EmptyRecord>, EmptyRecord>>;
type TestNonArrayObjectFunction = ExpectTrue<Equal<NonArrayObject<() => unknown>, () => unknown>>;
type TestNonArrayObjectArray = ExpectTrue<Equal<NonArrayObject<[]>, never>>;
type TestNonArrayReadonlyArray = ExpectTrue<Equal<NonArrayObject<ReadonlyArray<unknown>>, never>>;
//#endregion

export type RequiredProp<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type UnionToRecord<T extends string> = {
	[K in T]: K;
};

//#region <RequireAtLeastOneProp Tests>
type TestRequireAtLeastOnePropProducesUnion = ExpectTrue<
	Equal<
		RequireAtLeastOneProp<{ a?: string; b?: number; c?: boolean }, "a" | "b">,
		{ a: string; b?: number; c?: boolean } | { a?: string; b: number; c?: boolean }
	>
>;
type TestRequireAtLeastOneDefaultIsUnionOfAllProps = ExpectTrue<
	Equal<
		RequireAtLeastOneProp<{ a?: string; b?: number; c?: boolean }>,
		| { a: string; b?: number; c?: boolean }
		| { a?: string; b: number; c?: boolean }
		| { a?: string; b?: number; c: boolean }
	>
>;
type TestRequireAtLeastOnePropPreservesPreviouslyRequiredProp = ExpectTrue<
	Equal<
		RequireAtLeastOneProp<{ a: string; b?: number; c?: boolean }, "a" | "b">,
		{ a: string; b?: number; c?: boolean } | { a: string; b: number; c?: boolean }
	>
>;
//#endregion

type IsSubtype<SubT, SuperT> = SubT extends SuperT ? true : false;

type And<T extends NonEmptyArray<boolean>> = T extends [infer First, ...infer Rest]
	? false extends First
		? false
		: Rest extends NonEmptyArray<boolean>
			? And<Rest>
			: true
	: never;

type Or<T extends NonEmptyArray<boolean>> = T extends [infer First, ...infer Rest]
	? true extends First
		? true
		: Rest extends NonEmptyArray<boolean>
			? Or<Rest>
			: false
	: never;

export type PathFromObject<T, IncludeArrayKeys extends boolean = false> = T extends T
	? PathFromObjectInternal<T, IncludeArrayKeys>
	: never;

type PathFromObjectInternal<T, IncludeArrayKeys extends boolean> = And<
	[IsSubtype<T, object>, Or<[IncludeArrayKeys, NonArrayObject<T> extends never ? false : true]>]
> extends true
	? {
			[K in Exclude<keyof T, symbol>]-?: And<
				[
					IsSubtype<NonNullable<T[K]>, object>,
					Or<[IncludeArrayKeys, NonArrayObject<NonNullable<T[K]>> extends never ? false : true]>,
				]
			> extends true
				? K | `${K}.${PathFromObjectInternal<NonNullable<T[K]>, IncludeArrayKeys>}`
				: K;
		}[Exclude<keyof T, symbol>]
	: "";

type ExtractObjectType<T> = T extends object ? T : never;

export type TypeOfValueAtPath<T extends object, Path extends PathFromObject<T>> = Path extends keyof T
	? T[Path]
	: Path extends `${infer First}.${infer Rest}`
		? First extends keyof T
			? undefined extends T[First]
				? Rest extends PathFromObject<ExtractObjectType<T[First]>>
					? TypeOfValueAtPath<ExtractObjectType<T[First]>, Rest> | undefined
					: never
				: Rest extends PathFromObject<ExtractObjectType<T[First]>>
					? TypeOfValueAtPath<ExtractObjectType<T[First]>, Rest>
					: never
			: never
		: never;
