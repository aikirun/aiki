import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAppServerConfig } from "./config/loader";
import { startAppServer } from "./serve";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "../.env");

const config = await loadAppServerConfig({ path: envPath });

await startAppServer({ config });
