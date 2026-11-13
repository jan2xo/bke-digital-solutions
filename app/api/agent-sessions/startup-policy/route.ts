import { standaloneStartupPolicyHttp } from
  "@/apps/web/agent-sessions/standalone-startup-policy-http";

// Deliberately POST-only. The real installed Agent attestation is mandatory;
// no browser/account login or unsigned product request authorizes issuance.
export async function POST(request: Request) {
  return standaloneStartupPolicyHttp(request);
}
