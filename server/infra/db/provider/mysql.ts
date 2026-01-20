export interface MySqlDatabaseOptions {
	provider: "mysql";
	url: string;
	maxConnections?: number;
	ssl?: boolean;
}
