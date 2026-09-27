export function createEmbeddedDataLoader<T>(dataPath: string) {
	let embeddedData: T | undefined;
	return {
		async load() {
			if (!embeddedData) {
				embeddedData = JSON.parse(await Bun.file(dataPath).text()) as T;
			}
			return embeddedData;
		},
	};
}
