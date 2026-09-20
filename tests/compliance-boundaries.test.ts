import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPLIANCE_STATUSES, isMutableComplianceStatus } from "@/lib/compliance";

const route = readFileSync("app/api/admin/compliance/route.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260815152000_compliance_boundaries/migration.sql", "utf8");
const page = readFileSync("app/admin/compliance/page.tsx", "utf8");
const controls = readFileSync("components/compliance-admin-controls.tsx", "utf8");

describe("Phase 6.7 compliance mutation boundaries", () => {
  it("keeps admin mutations behind recent auth, same-origin, rate limit, and audit logging", () => {
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain("rateLimit(`admin-compliance:");
    expect(route).toContain("COMPLIANCE_STATUS_CHANGED");
    expect(route).toContain("COMPLIANCE_EVIDENCE_RECORDED");
  });

  it("does not expose an API path for fabricating professional approval", () => {
    expect(COMPLIANCE_STATUSES).not.toContain("IMPLEMENTED");
    expect(isMutableComplianceStatus("PENDING_DPO_REVIEW")).toBe(true);
    expect(isMutableComplianceStatus("IMPLEMENTED")).toBe(false);
    expect(route).toContain("z.enum(COMPLIANCE_STATUSES)");
  });

  it("persists only constrained states while preserving existing technical implemented records", () => {
    expect(migration).toContain("ComplianceRequirement_status_allowed_chk");
    expect(migration).toContain("'IMPLEMENTED'");
    for (const status of COMPLIANCE_STATUSES) expect(migration).toContain(`'${status}'`);
  });

  it("enforces compliance evidence as append-only at the database boundary", () => {
    expect(migration).toContain("prevent_compliance_evidence_mutation");
    expect(migration).toContain("BEFORE UPDATE ON \"ComplianceEvidence\"");
    expect(migration).toContain("BEFORE DELETE ON \"ComplianceEvidence\"");
    expect(migration).toContain("COMPLIANCE_EVIDENCE_IMMUTABLE");
  });

  it("provides an administrator control surface without changing legal semantics", () => {
    expect(page).toContain("ComplianceAdminControls");
    expect(page).toContain("No entry on this page represents legal, tax, privacy, or regulatory approval");
  });

  it("keeps evidence recording separate from explicit owner completion", () => {
    expect(route).toContain('action: z.literal("COMPLETE")');
    expect(route).toContain("COMPLIANCE_REQUIREMENT_IMPLEMENTED");
    expect(route).toContain('status: "IMPLEMENTED"');
    expect(route).toContain("COMPLIANCE_IMPLEMENTED_IMMUTABLE");
    expect(controls).toContain("Mark Implemented");
    expect(controls).toContain("confirmation: true");
  });

  it("supports explicit audited reopening without mutating evidence history", () => {
    expect(route).toContain('action: z.literal("REOPEN")');
    expect(route).toContain("COMPLIANCE_REOPEN_REQUIRES_IMPLEMENTED");
    expect(route).toContain("COMPLIANCE_REQUIREMENT_REOPENED");
    expect(controls).toContain("Reopen Review");
  });
});
