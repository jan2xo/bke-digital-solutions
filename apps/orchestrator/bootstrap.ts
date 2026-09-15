import {
  ECHO_CAPABILITY_ID,
  type EchoCapabilityV1,
} from "../../modules/echo/contracts/echo.contract";
import { echoModule } from "../../modules/echo/module";
import { composeCapabilities } from "../../platform/composition/composer";

const application = await composeCapabilities([echoModule]);
const echo = application.get<EchoCapabilityV1>(ECHO_CAPABILITY_ID);
const result = echo.echo("composition");

if (result !== "echo:composition") {
  throw new Error(`Unexpected composed Echo output: ${result}`);
}

console.log(`V2 composition GREEN: ${result}`);
