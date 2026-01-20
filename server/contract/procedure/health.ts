import { oc } from "@orpc/contract";
import { type } from "arktype";

import type { ContractProcedure } from "./helper";

const healthV1: ContractProcedure<void, void> = oc.input(type("undefined")).output(type("undefined"));

export const healthContract = { healthV1 };

export type HealthContract = typeof healthContract;
