import type { ModuleManifest } from "../../contracts/capability";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";

export const identityModuleManifest = Object.freeze({
  moduleId: "identity",
  needs: [],
  provides: [
    IDENTITY_LOOKUP_CAPABILITY_ID,
    IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
  ],
} satisfies ModuleManifest);
