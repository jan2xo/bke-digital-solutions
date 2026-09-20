import { describe, expect, it } from "vitest";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  AgentAccountSessionProtocolError,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";

function request(headers: Record<string, string> = {}) {
  return new Request("https://jl-bke.com/api/agent-sessions/device/start", {
    method: "POST",
    headers,
  });
}

describe("V3 Agent account-session protocol", () => {
  it("accepts the exact protocol version", () => {
    expect(() => requireAgentAccountSessionProtocol(request({
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    }))).not.toThrow();
  });

  it("fails closed on protocol drift", () => {
    expect(() => requireAgentAccountSessionProtocol(request({
      "x-bke-account-session-version": "bke.account-session.v2",
    }))).toThrow(AgentAccountSessionProtocolError);
    try {
      requireAgentAccountSessionProtocol(request());
    } catch (error) {
      expect(error).toMatchObject({
        code: "ACCOUNT_SESSION_PROTOCOL_MISMATCH",
        status: 400,
      });
    }
  });

  it("rejects browser-origin requests on machine endpoints", () => {
    expect(() => rejectBrowserOriginForAgent(request())).not.toThrow();
    try {
      rejectBrowserOriginForAgent(request({ origin: "https://jl-bke.com" }));
    } catch (error) {
      expect(error).toMatchObject({
        code: "BROWSER_ORIGIN_REJECTED",
        status: 403,
      });
    }
  });
});
