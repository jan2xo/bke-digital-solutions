import "server-only";

import { resolveCommercialPrivateKey } from "@bke/licensing/logic/commercial-signing-registry";
import { activeLicensingSigningKey } from "@/apps/web/licensing/signing-key-registry";
import {
  signAgentAccountRepairPolicy,
  type AgentAccountRepairPolicyInput,
  type SignedAgentAccountRepairPolicy,
} from "./repair-policy";

export async function issueAgentAccountRepairPolicy(
  input: AgentAccountRepairPolicyInput,
  issuedAt = new Date(),
): Promise<SignedAgentAccountRepairPolicy> {
  const active = await activeLicensingSigningKey();
  return signAgentAccountRepairPolicy(
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
