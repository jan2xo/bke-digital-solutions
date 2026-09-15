import "dotenv/config";
import { parseEnvironment } from "../v2/platform/host/config/environment";

const environment = parseEnvironment(process.env);
console.info(`Configuration valid for ${environment.DEPLOYMENT_ENV} (${environment.DEPLOYMENT_ID}).`);
