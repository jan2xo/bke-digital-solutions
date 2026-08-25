import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const accountPage = readFileSync("app/dashboard/accounts/[id]/page.tsx", "utf8");
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
    expect(read("app/admin/compliance/page.tsx")).toContain("className=\"card p-5\"");
    expect(read("app/admin/supply-chain/page.tsx")).toContain("bg-[#172432]");
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

  it("keeps authentication notices readable on light utility surfaces", () => {
    const styles = read("app/globals.css");
    const mfaPage = read("app/login/mfa/page.tsx");
    const magicLink = read("components/magic-link-form.tsx");
    expect(styles).toContain("main > section .bg-blue-50");
    expect(styles).toContain("main > section .bg-amber-50");
    expect(styles).toContain("main > section .bg-emerald-50");
    expect(mfaPage).toContain("text-blue-950");
    expect(mfaPage).toContain("text-amber-950");
    expect(magicLink).toContain("text-emerald-950");
  });
});
