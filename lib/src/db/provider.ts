export const DATABASE_PROVIDERS = ["pg" /*, "sqlite", "mysql"*/] as const;
export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];

export function isDatabaseProvider(provider: string): provider is DatabaseProvider {
	for (const databaseProvider of DATABASE_PROVIDERS) {
		if (provider === databaseProvider) {
			return true;
		}
	}
	return false;
}
