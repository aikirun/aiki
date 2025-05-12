import type { ExpectTrue, Equal, ExpectFalse } from "./expect.ts";

export type NonEmptyArray<T> = [T, ...T[]];
//#region <NonEmptyArray Tests>
type TestNonEmptyArrayShouldBeATupleOfOneOrMoreElements = ExpectTrue<
    Equal<NonEmptyArray<number>, [number, ...number[]]>
>;
type TestNonEmptyArrayIsNotEmptyTuple = ExpectFalse<Equal<NonEmptyArray<number>, []>>;
type TestNonEmptyArrayIsNotSingleItemTuple = ExpectFalse<Equal<NonEmptyArray<number>, [number]>>;
type TestNonEmptyArrayIsNotarray = ExpectFalse<Equal<NonEmptyArray<number>, number[]>>;
//#endregion

export function groupBy<Item, Key, Value>(
    items: Item[], 
    unwrap: (item: Item) => [Key, Value]
) {
    const result = new Map<Key, NonEmptyArray<Value>>();
    for (const item of items) {
        const [key, value] = unwrap(item);
        const valuesWithSameKey = result.get(key);

        if (valuesWithSameKey === undefined) {
            result.set(key, [value]);
        } else {
            valuesWithSameKey.push(value);
        }
    }

    return result;
}