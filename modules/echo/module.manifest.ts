import type { ModuleManifest } from "../../contracts/capability";
import { ECHO_CAPABILITY_ID } from "./contracts/echo.contract";

export const echoModuleManifest = Object.freeze({
  moduleId: "echo",
  needs: [],
  provides: [ECHO_CAPABILITY_ID],
} satisfies ModuleManifest);
