import type { CapabilityModule } from "../../contracts/capability";
import { ECHO_CAPABILITY_ID } from "./contracts/echo.contract";
import { createEchoCapability } from "./logic/echo-capability";
import { echoModuleManifest } from "./module.manifest";

export const echoModule: CapabilityModule = Object.freeze({
  manifest: echoModuleManifest,
  start() {
    return [
      {
        id: ECHO_CAPABILITY_ID,
        value: createEchoCapability(),
      },
    ];
  },
});
