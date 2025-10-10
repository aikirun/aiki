import { implement } from "@orpc/server";
import { contract } from "@aiki/contract";
import { type ServerContext, withErrorHandler } from "../middleware/mod.ts";

export const baseImplementer = implement(contract)
	.$context<ServerContext>()
	.use(withErrorHandler);
