export type RequireAtLeastOneOf<T, Keys extends keyof T> = {
	[K in Keys]-?: Required<Pick<T, K>> & Omit<T, K>;
}[Keys];
