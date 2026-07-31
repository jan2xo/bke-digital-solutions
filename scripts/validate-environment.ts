import "dotenv/config";
import { parseEnvironment } from "../lib/config/environment";

const environment = parseEnvironment(process.env);
console.info(`Configuration valid for ${environment.DEPLOYMENT_ENV} (${environment.DEPLOYMENT_ID}).`);
