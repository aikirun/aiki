import { publicImplementer } from "../implementer";

const os = publicImplementer.health;

const healthV1 = os.healthV1.handler(() => {});

export const healthRouter = os.router({ healthV1 });
