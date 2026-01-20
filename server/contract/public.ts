import { healthContract } from "./procedure/health";

export const publicContract = { health: healthContract };

export type PublicContract = typeof publicContract;
