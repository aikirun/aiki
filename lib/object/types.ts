import type { NonEmptyArray } from "../array";
import type { Equal, ExpectTrue } from "../testing/expect/types";
import type { RequireAtLeastOneOf } from "@aikirun/types/utils";
export type { RequireAtLeastOneOf };

export type UndefinedToPartial<T extends object> = {
	[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
} & {
	[K in keyof T as undefined extends T[K] ? never : K]: T[K];
};
//#region <UndefinedToPartial Tests>
type TestUndefinedToPartial = ExpectTrue<
	Equal<UndefinedToPartial<{ a: number; b: string | undefined; c?: boolean }>, { a: number; b?: string; c?: boolean }>
>;
//#endregion

export type MaybeField<Key extends string, Value> = Value extends undefined
	? { [K in Key]?: undefined }
	: { [K in Key]: Value };

export type EmptyRecord = Record<PropertyKey, never>;

export type NonArrayObject<T> = T extends object ? (T extends ReadonlyArray<unknown> ? never : T) : never;
//#region <NonArrayObject Tests>
type TestNonArrayObjectPlainObject = ExpectTrue<Equal<NonArrayObject<EmptyRecord>, EmptyRecord>>;
type TestNonArrayObjectFunction = ExpectTrue<Equal<NonArrayObject<() => unknown>, () => unknown>>;
type TestNonArrayObjectArray = ExpectTrue<Equal<NonArrayObject<[]>, never>>;
type TestNonArrayReadonlyArray = ExpectTrue<Equal<NonArrayObject<ReadonlyArray<unknown>>, never>>;
//#endregion

export type RequiredDeep<T> = NonArrayObject<T> extends never
	? T
	: {
			[K in keyof T]-?: RequiredDeep<T[K]>;
		};
//#region <RequiredDeep Tests>
type TestRequiredDeep = ExpectTrue<
	Equal<
		RequiredDeep<{
			a?: {
				b?: string;
				c: number;
				d?: {
					e?: [];
				};
			};
		}>,
		{
			a: {
				b: string;
				c: number;
				d: {
					e: [];
				};
			};
		}
	>
>;
//#endregion

export type UnionToRecord<T extends string> = {
	[K in T]: K;
};

//#region <RequireAtLeastOneOf Tests>
type TestRequireAtLeastOneOfProducesUnion = ExpectTrue<
	Equal<
		RequireAtLeastOneOf<{ a?: string; b?: number; c?: boolean }, "a" | "b">,
		{ a: string; b?: number; c?: boolean } | { a?: string; b: number; c?: boolean }
	>
>;
type TestRequireAtLeastOneOfPreservesPreviouslyRequiredField = ExpectTrue<
	Equal<
		RequireAtLeastOneOf<{ a: string; b?: number; c?: boolean }, "a" | "b">,
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
