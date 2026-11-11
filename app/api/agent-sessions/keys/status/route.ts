import { agentKeyHttp } from "@/apps/web/agent-sessions/agent-key-http";

export async function POST(request: Request) {
  return agentKeyHttp(request, "status");
}
