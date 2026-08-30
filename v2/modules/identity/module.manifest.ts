import type { ModuleManifest } from "../../contracts/capability";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";
import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "./contracts/login-mfa-challenge.contract";
import { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "./contracts/login-mfa-verification.contract";
import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "./contracts/session-termination.contract";
import { IDENTITY_SESSION_VALIDATION_CAPABILITY_ID } from "./contracts/session-validation.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "./contracts/session.contract";

export const identityModuleManifest = Object.freeze({
  moduleId: "identity",
  needs: [],
  provides: [
    IDENTITY_LOOKUP_CAPABILITY_ID,
    IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
    IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
    IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
    IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
    IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
    IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,
  ],
} satisfies ModuleManifest);
