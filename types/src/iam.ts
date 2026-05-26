import type { Logger } from "@aikirun/lib/logger";

import type { NamespaceId } from "./namespace";
import type { OrganizationId } from "./organization";

export interface ApiAuthorization {
	organizationId: OrganizationId;
	namespaceId: NamespaceId;
	userId?: string;
}

export type ApiAuthorizer = (request: Request) => ApiAuthorization | Promise<ApiAuthorization>;
export type DashboardAuthenticator = (request: Request) => Promise<Response>;
export type OrganizationDashboardHandler = (request: Request) => Promise<Response>;

export interface DashboardIam {
	authenticator: DashboardAuthenticator;
	organization: OrganizationDashboardHandler;
}

export interface IamContext {
	logger: Logger;
}

export type CreateApiAuthorizer = (context: IamContext) => ApiAuthorizer;
export type CreateDashboardAuthenticator = (context: IamContext) => DashboardAuthenticator;
export type CreateOrganizationDashboardHandler = (context: IamContext) => OrganizationDashboardHandler;
export type CreateDashboardIam = (context: IamContext) => DashboardIam;

export interface Iam {
	api?: CreateApiAuthorizer;
	dashboard?: CreateDashboardIam;
}
