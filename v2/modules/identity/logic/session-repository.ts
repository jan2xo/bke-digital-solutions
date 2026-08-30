import type {
  IdentityIssuedSession,
  IdentitySessionAssuranceLevel,
  IdentitySessionAuthenticationMethod,
} from "../contracts/session.contract";

export interface IdentitySessionPersistenceInput {
  readonly id: string;
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly lastAuthenticatedAt: Date;
  readonly mfaVerifiedAt: Date | null;
  readonly recentAuthenticatedAt: Date | null;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly userAgentSummary: string | null;
  readonly networkHint: string | null;
  readonly authenticationMethod: IdentitySessionAuthenticationMethod;
  readonly assuranceLevel: IdentitySessionAssuranceLevel;
}

export type IdentitySessionPersistenceResult =
  | { readonly status: "CREATED"; readonly session: IdentityIssuedSession }
  | { readonly status: "PRINCIPAL_NOT_FOUND" }
  | { readonly status: "ACCOUNT_NOT_ACTIVE" };

export interface IdentitySessionRepository {
  issueSession(
    input: IdentitySessionPersistenceInput,
  ): Promise<IdentitySessionPersistenceResult>;
}
