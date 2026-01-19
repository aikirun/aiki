export interface MySqlDatabaseOptions {
	provider: "mysql";
	connectionString: string;
	maxConnections?: number;
	ssl?: boolean;
}
