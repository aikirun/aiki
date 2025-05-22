import type { Equal, ExpectTrue } from "./expect.ts";

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

export type MaybeField<Key extends string, Value> = Value extends undefined
  ? { [K in Key]?: undefined }
  : { [K in Key]: Value };
