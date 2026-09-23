import "server-only";

import { resolveCommercialPrivateKey } from "@bke/licensing/logic/commercial-signing-registry";
import { activeLicensingSigningKey } from "@/apps/web/licensing/signing-key-registry";
import {
  signAgentAccountUpdatePolicy,
  type AgentAccountUpdatePolicyInput,
  type SignedAgentAccountUpdatePolicy,
} from "./update-policy";

export async function issueAgentAccountUpdatePolicy(
  input: AgentAccountUpdatePolicyInput,
  issuedAt = new Date(),
): Promise<SignedAgentAccountUpdatePolicy> {
  const active = await activeLicensingSigningKey();
  return signAgentAccountUpdatePolicy(
    input,
    {
      keyId: active.keyId,
      algorithm: active.algorithm,
      publicKey: active.publicKey,
      privateKey: resolveCommercialPrivateKey(active.privateKeyReference),
    },
    issuedAt,
  );
}
