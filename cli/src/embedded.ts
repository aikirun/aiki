import type { DatabaseProvider } from "@aikirun/lib/db";
import type { Migrations } from "@aikirun/lib/db/migrate";

import embeddedDataPath from "./embedded.data" with { type: "file" };
import type { Package } from "./packages";

export interface EmbeddedPackageData {
	migrationsTable: string;
	migrationsByProvider: Partial<Record<DatabaseProvider, Migrations>>;
}

export type EmbeddedData = {
	version: "1";
	data: Partial<Record<Package, EmbeddedPackageData>>;
};

function createEmbeddedDataLoader() {
	let embeddedData: EmbeddedData | undefined;
	return {
		async load() {
			if (!embeddedData) {
				embeddedData = JSON.parse(await Bun.file(embeddedDataPath).text()) as EmbeddedData;
			}
			return embeddedData;
		},
	};
}

export const embeddedDataLoader = createEmbeddedDataLoader();
