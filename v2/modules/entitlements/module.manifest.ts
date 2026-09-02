import type { ModuleManifest } from "../../contracts/capability";
import { ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID } from "./contracts/durable-right-grant.contract";

export const entitlementsModuleManifest = Object.freeze({
  moduleId: "entitlements",
  needs: [],
  provides: [ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID],
} satisfies ModuleManifest);
