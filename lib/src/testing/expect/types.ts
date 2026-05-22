export type ExpectTrue<T extends true> = T;

export type ExpectFalse<T extends false> = T;

type ToConditional<T> = <X>() => X extends T ? 1 : 0;
export type Equal<U, T> = ToConditional<U> extends ToConditional<T> ? true : false;
