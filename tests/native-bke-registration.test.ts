import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("native Google handoff registration prerequisites", () => {
  it("preserves native protocol and published legal document access without creating a password or browser session", () => {
    const preflight = readFileSync("app/api/agent-sessions/native/registration/route.ts", "utf8");
    for (const marker of ["rejectBrowserOriginForAgent(request)", "requireAgentAccountSessionProtocol(request)", "registrationLegalDocuments", "currentPublishedVersionId", "content_markdown", "applyLegalVariables"]) expect(preflight).toContain(marker);
    expect(preflight).not.toContain("createSession");
    expect(preflight).not.toContain("password");
  });
});
