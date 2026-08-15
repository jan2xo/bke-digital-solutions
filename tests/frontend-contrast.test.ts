import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("light UI surface contrast", () => {
  it("keeps shared admin table content readable on white", () => {
    expect(read("components/admin-table.tsx")).toContain("bg-white text-slate-900");
  });

  it("keeps dashboard stat content readable on slate-50", () => {
    expect(read("app/dashboard/page.tsx")).toContain("bg-slate-50 p-3 text-slate-900");
  });

  it("keeps standalone admin light panels readable", () => {
    expect(read("app/admin/compliance/page.tsx")).toContain("bg-white p-5 text-slate-900");
    expect(read("app/admin/supply-chain/page.tsx")).toContain("bg-white text-slate-900");
  });
});
