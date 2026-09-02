import type { ModuleManifest } from "../../contracts/capability";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "./contracts/acceptance.contract";

export const legalModuleManifest = Object.freeze({
  moduleId: "legal",
  needs: [],
  provides: [LEGAL_ACCEPTANCE_CAPABILITY_ID],
} satisfies ModuleManifest);
