export type RequireAtLeastOneProp<T, Keys extends keyof T = keyof T> = {
	[K in Keys]-?: Required<Pick<T, K>> & Omit<T, K>;
}[Keys];

export type DistributiveOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;

export type OptionalProp<T, K extends keyof T> = Omit<T, K> & { [Key in K]?: T[Key] };

export type RequiredProp<T, K extends keyof T> = T & {
	[Key in K]-?: Exclude<T[K], undefined>;
};

export type RequiredNonNullableProp<T, K extends keyof T> = T & {
	[Key in K]-?: NonNullable<T[K]>;
};
