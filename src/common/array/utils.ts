import { NonEmptyArray } from "./types.ts";

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