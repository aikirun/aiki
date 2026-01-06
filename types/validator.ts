export interface Schema<Data> {
	parse: (data: unknown) => Awaited<Data>;
}
