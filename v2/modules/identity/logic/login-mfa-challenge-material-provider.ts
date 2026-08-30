export interface IdentityLoginMfaChallengeMaterial {
  readonly challengeId: string;
  readonly token: string;
  readonly tokenHash: string;
  readonly code: string;
  readonly codeHash: string;
  readonly reference: string;
}

export interface IdentityLoginMfaChallengeMaterialProvider {
  issue(): IdentityLoginMfaChallengeMaterial;
}
