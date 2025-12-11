import { implement } from "@orpc/server";
import { contract } from "../contract/index.ts";
import { type ServerContext, withErrorHandler } from "../middleware/index.ts";

export const baseImplementer = implement(contract).$context<ServerContext>().use(withErrorHandler);
