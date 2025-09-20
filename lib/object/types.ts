import type { Equal, ExpectTrue } from "../testing/expect/types.ts";

export type UndefinedToPartial<T extends object> =
	& {
		[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
			T[K],
			undefined
		>;
	}
	& {
		[K in keyof T as undefined extends T[K] ? never : K]: T[K];
	};
//#region <UndefinedToPartial Tests>
type TestUndefinedToPartial = ExpectTrue<
	Equal<
		UndefinedToPartial<{ a: number; b: string | undefined; c?: boolean }>,
		{ a: number; b?: string; c?: boolean }
	>
>;
//#endregion

export type MaybeField<Key extends string, Value> = Value extends undefined ? { [K in Key]?: undefined }
	: { [K in Key]: Value };

export type EmptyObject = Record<PropertyKey, never>;

export type NonArrayObject<T> = T extends object ? (T extends ReadonlyArray<unknown> ? never : T) : never;
//#region <NonArrayObject Tests>
type TestNonArrayObjectPlanObject = ExpectTrue<Equal<NonArrayObject<EmptyObject>, EmptyObject>>;
type TestNonArrayObjectFunction = ExpectTrue<Equal<NonArrayObject<() => unknown>, () => unknown>>;
type TestNonArrayObjectArray = ExpectTrue<Equal<NonArrayObject<[]>, never>>;
type TestNonArrayReadonlyArray = ExpectTrue<Equal<NonArrayObject<ReadonlyArray<unknown>>, never>>;
//#endregion

export type RequiredDeep<T> = NonArrayObject<T> extends never ? T
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
				}
			};
		}
	>
>;
//#endregion
