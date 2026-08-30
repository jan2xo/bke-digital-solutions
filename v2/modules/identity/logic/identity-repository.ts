import type { IdentityPrincipal } from "../contracts/identity.contract";

export interface IdentityRepository {
  findById(userId: string): Promise<IdentityPrincipal | null>;
  findByEmail(email: string): Promise<IdentityPrincipal | null>;
}
