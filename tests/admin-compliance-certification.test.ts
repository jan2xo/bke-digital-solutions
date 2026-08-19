import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/admin/supply-chain/route.ts", "utf8");
const controls = readFileSync("components/release-evidence-controls.tsx", "utf8");
const page = readFileSync("app/admin/releases/[id]/page.tsx", "utf8");

describe("Admin-native commercial compliance certification", () => {
  it("uses a protected server action with current legal and payload binding", () => {
    expect(route).toContain('"CERTIFY_COMPLIANCE"');
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("COMPLIANCE_ATTESTATION_REQUIRED");
    expect(route).toContain("COMPLIANCE_LEGAL_DOCUMENTS_UNAVAILABLE");
    expect(route).toContain("SUPPLY_CHAIN_COMPLIANCE_CERTIFIED");
    expect(route).toContain("canonicalPayloadHash");
    expect(route).toContain("currentPublishedVersionId");
  });

  it("offers an explicit human attestation without DevTools", () => {
    expect(controls).toContain("CERTIFY_COMPLIANCE");
    expect(controls).toContain('aria-label="Compliance scope"');
    expect(controls).toContain("scope (optional)");
    expect(controls).not.toContain('aria-label="Compliance reviewer"');
    expect(controls).not.toContain('aria-label="Compliance role"');
    expect(controls).toContain("attestation: true");
    expect(controls).toContain("authenticated administrator");
  });

  it("passes the current legal state into readiness rendering", () => {
    expect(page).toContain("complianceLegalReferencesCurrent");
    expect(page).toContain("releaseReadiness(version, { complianceCurrent })");
  });
});
