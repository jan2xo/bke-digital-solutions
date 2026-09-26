import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard account route contract", () => {
  it("uses one canonical dynamic account parameter", () => {
    const dynamicDirectories = readdirSync("app/dashboard/accounts", {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^\[[^\]]+\]$/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();

    expect(dynamicDirectories).toEqual(["[accountId]"]);
  });

  it("binds the account page to accountId", () => {
    const source = readFileSync(
      "app/dashboard/accounts/[accountId]/page.tsx",
      "utf8",
    );

    expect(source).toContain(
      "params: Promise<{ accountId: string }>",
    );
    expect(source).toContain("const { accountId } = await params;");
    expect(source).not.toContain(
      "params: Promise<{ id: string }>",
    );
  });
});
