export interface IdentityLoginMfaProofProvider {
  hashChallengeToken(token: string): string;
  verifyEmailCode(codeHash: string, candidate: string): boolean;
  hashRecoveryCode(candidate: string): string;
}
