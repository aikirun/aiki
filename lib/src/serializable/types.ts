/**
 * Resolves to `unknown` when T is JSON serializable, or to an object that names every
 * non-serializable path. Intersect it with a parameter type, and a call that carries
 * a Date, a Map, a bigint, a function, or `any` fails to compile with the path in
 * the message:
 *
 * ```
 * Property '"Aiki: not serializable"' is missing in type '{ ... }'
 *   but required in type '{ "Aiki: not serializable": "output.user.createdAt is Date" }'.
 * ```
 *
 * It cannot be a generic constraint: TypeScript rejects `T extends Serializable<T, "…">` as circular.
 */
export type Serializable<T, Label extends string> = [NonSerializablePaths<T, Label>] extends [never]
	? unknown
	: { "Aiki: not serializable": NonSerializablePaths<T, Label> };

// biome-ignore lint/suspicious/noConfusingVoidType: a handler that returns nothing has a void output
type Scalar = string | number | boolean | null | undefined | void;

type Builtin =
	| Date
	| RegExp
	| Map<unknown, unknown>
	| Set<unknown>
	| WeakMap<object, unknown>
	| WeakSet<object>
	| Promise<unknown>
	| ArrayBuffer
	| ArrayBufferView;

type BuiltinName<T> = T extends Date
	? "Date"
	: T extends RegExp
		? "RegExp"
		: T extends Map<unknown, unknown>
			? "Map"
			: T extends Set<unknown>
				? "Set"
				: T extends WeakMap<object, unknown>
					? "WeakMap"
					: T extends WeakSet<object>
						? "WeakSet"
						: T extends Promise<unknown>
							? "Promise"
							: "binary data";
type IsAny<T> = 0 extends 1 & T ? true : false;

// A recursive type has no bottom, so the walk stops here and trusts what lies deeper.
type MaxDepth = 16;

type NonSerializablePaths<T, Path extends string, Depth extends unknown[] = []> = Depth["length"] extends MaxDepth
	? never
	: IsAny<T> extends true
		? `${Path} is any`
		: T extends Scalar
			? never
			: T extends bigint
				? `${Path} is bigint`
				: T extends symbol
					? `${Path} is symbol`
					: T extends (...args: never[]) => unknown
						? `${Path} is a function`
						: T extends Builtin
							? `${Path} is ${BuiltinName<T>}`
							: T extends readonly (infer Element)[]
								? NonSerializablePaths<Element, `${Path}[]`, [...Depth, 1]>
								: T extends object
									? {
											[Key in keyof T & (string | number)]: NonSerializablePaths<
												T[Key],
												`${Path}.${Key}`,
												[...Depth, 1]
											>;
										}[keyof T & (string | number)]
									: `${Path} is unknown`;
