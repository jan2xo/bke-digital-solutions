export const IDENTITY_LOOKUP_CAPABILITY_ID = "bke.identity.lookup.v1" as const;

export type IdentityRole = "CUSTOMER" | "ADMIN";

export type IdentityLifecycleState =
  | "ACTIVE"
  | "SUSPENDED"
  | "CLOSURE_REQUESTED"
  | "CLOSED"
  | "PRIVACY_REVIEW"
  | "PSEUDONYMIZED"
  | "PURGE_ELIGIBLE";

export interface IdentityPrincipal {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly emailVerified: Date | null;
  readonly role: IdentityRole;
  readonly suspendedAt: Date | null;
  readonly lifecycleState: IdentityLifecycleState;
}

export type IdentityLookupFailureCode =
  | "INVALID_IDENTIFIER"
  | "PERSISTENCE_UNAVAILABLE";

export type IdentityLookupResult =
  | { readonly status: "FOUND"; readonly principal: IdentityPrincipal }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "FAILED"; readonly code: IdentityLookupFailureCode };

export interface IdentityLookupCapability {
  findById(userId: string): Promise<IdentityLookupResult>;
  findByEmail(email: string): Promise<IdentityLookupResult>;
}
