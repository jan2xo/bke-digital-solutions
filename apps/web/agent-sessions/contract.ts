import "server-only";

export const AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION = "bke.account-session.v1" as const;

export class AgentAccountSessionProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function requireAgentAccountSessionProtocol(request: Request): void {
  const version = request.headers.get("x-bke-account-session-version");
  if (version !== AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION) {
    throw new AgentAccountSessionProtocolError("ACCOUNT_SESSION_PROTOCOL_MISMATCH", 400);
  }
}

export function rejectBrowserOriginForAgent(request: Request): void {
  if (request.headers.has("origin")) {
    throw new AgentAccountSessionProtocolError("BROWSER_ORIGIN_REJECTED", 403);
  }
}
