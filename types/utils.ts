export type RequireAtLeastOneProp<T, Keys extends keyof T = keyof T> = {
	[K in Keys]-?: Required<Pick<T, K>> & Omit<T, K>;
}[Keys];

export type DistributiveOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
