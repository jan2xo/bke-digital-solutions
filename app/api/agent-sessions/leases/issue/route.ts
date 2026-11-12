import { agentAccountProductLeaseHttp } from "@/apps/web/agent-sessions/account-product-lease-http";

export async function POST(request: Request) {
  return agentAccountProductLeaseHttp(request, "issue");
}
