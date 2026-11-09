import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const accountPage = readFileSync("app/dashboard/accounts/[accountId]/page.tsx", "utf8");
const licensingPage = readFileSync("app/licensing/page.tsx", "utf8");
const read = (path: string) => readFileSync(path, "utf8");

describe("customer-facing contrast safeguards", () => {
  it("keeps shared admin table content readable on dark surfaces", () => {
    expect(read("components/admin-table.tsx")).toContain("admin-table-wrap");
    expect(read("app/globals.css")).toContain(".admin-table td");
  });

  it("keeps dashboard stat content readable on slate-50", () => {
    expect(read("app/dashboard/page.tsx")).toContain("account-stat-card rounded-lg p-3");
  });

  it("keeps standalone admin light panels readable", () => {
    expect(read("app/admin/compliance/page.tsx")).toContain('className="card p-5"');
  });

  it("keeps account metadata and secondary content on readable dark-theme colors", () => {
    expect(accountPage).toContain("text-sky-300");
    expect(accountPage).toContain("text-[#a8b5c4]");
    expect(accountPage).toContain("text-sky-300 underline");
    expect(accountPage).not.toContain("text-[#0b7197]");
    expect(accountPage).not.toContain("bg-slate-50");
  });

  it("keeps licensing explanatory copy on the shared muted text token", () => {
    expect(licensingPage).toContain("text-[#a8b5c4]");
  });

  it("keeps unified Google sign-in and post-OIDC legal consent on readable surfaces", () => {
    const login = read("app/login/page.tsx");
    const entry = read("components/google-auth-button.tsx");
    const consent = read("components/google-enrollment-consent.tsx");
    const consentPage = read("app/auth/consent/page.tsx");
    expect(login).toContain("GoogleAuthButton");
    expect(login).toContain("text-[#a8b5c4]");
    expect(entry).toContain('props.flow === "unified"');
    expect(entry).not.toContain("legal-consent-panel");
    expect(consentPage).toContain('text-[#a8b5c4]');
    expect(consent).toContain('className="card grid gap-5 p-6"');
    expect(consent).toContain('className="font-bold text-[#ffd15a] underline"');
    expect(consent).toContain('className="button button-yellow"');
  });
});
