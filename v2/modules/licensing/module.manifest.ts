import type { ModuleManifest } from "../../contracts/capability";
import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "./contracts/license-key-reveal.contract";

export const licensingModuleManifest: ModuleManifest = Object.freeze({
  moduleId: "bke.licensing",
  needs: [],
  provides: [LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID],
});
