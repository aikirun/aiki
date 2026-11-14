import type { NonEmptyArray } from "../collection/array";

export type EmptyRecord = Record<PropertyKey, never>;

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type OptionalProp<T, K extends keyof T> = Omit<T, K> & { [Key in K]?: T[Key] };

export type NonArrayObject<T> = T extends object ? (T extends ReadonlyArray<unknown> ? never : T) : never;

export type DeepPartial<T> = {
	[Key in keyof T]?: T[Key] extends NonArrayObject<T[Key]> ? DeepPartial<T[Key]> : T[Key];
};

export type RequiredProp<T, K extends keyof T> = T & {
	[Key in K]-?: Exclude<T[K], undefined>;
};

export type RequiredNonNullableProp<T, K extends keyof T> = T & {
	[Key in K]-?: NonNullable<T[K]>;
};

export type RequireAtLeastOneProp<T, Keys extends keyof T = keyof T> = {
	[K in Keys]-?: Required<Pick<T, K>> & Omit<T, K>;
}[Keys];

export type AtMostOneProp<T, Keys extends keyof T = keyof T> =
	| {
			[K in Keys]-?: { [P in K]: T[K] } & { [P in Exclude<Keys, K>]?: never };
	  }[Keys]
	| Partial<Record<Keys, never>>;

type IsSubtype<SubT, SuperT> = SubT extends SuperT ? true : false;

type IsUnion<T, Copy = T> = T extends unknown ? ([Copy] extends [T] ? false : true) : never;

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

// Thanks to @refined[https://github.com/refined] for this type
export type PathFromObject<T, IncludeArrayKeys extends boolean = false> = T extends unknown
	? PathFromObjectInternal<T, IncludeArrayKeys>
	: never;

type PathFromObjectInternal<T, IncludeArrayKeys extends boolean> =
	And<[IsSubtype<T, object>, Or<[IncludeArrayKeys, NonArrayObject<T> extends never ? false : true]>]> extends true
		? {
				[K in Exclude<keyof T, symbol>]-?: And<
					[
						IsSubtype<NonNullable<T[K]>, object>,
						Or<[IncludeArrayKeys, NonArrayObject<NonNullable<T[K]>> extends never ? false : true]>,
						IsUnion<NonNullable<T[K]>> extends true ? false : true,
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
