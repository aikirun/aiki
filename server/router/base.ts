import { implement } from "@orpc/server";
import { contract } from "../contract/index";
import { type ServerContext, withErrorHandler } from "../middleware/index";

export const baseImplementer = implement(contract).$context<ServerContext>().use(withErrorHandler);
