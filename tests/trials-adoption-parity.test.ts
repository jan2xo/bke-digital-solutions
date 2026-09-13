import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changeTrial, grantProductTrial } from "@/lib/trials";

describe("trial adoption parity", () => {
  it("preserves the 0..14 day grace boundary before persistence", async () => {
    await expect(grantProductTrial({
      accountId: "account",
      editionId: "edition",
      source: "SELF_SERVICE",
      actorId: "actor",
      graceDays: -1,
    })).rejects.toThrow("INVALID_GRACE_PERIOD");

    await expect(grantProductTrial({
      accountId: "account",
      editionId: "edition",
      source: "ADMIN",
      actorId: "actor",
      graceDays: 15,
    })).rejects.toThrow("INVALID_GRACE_PERIOD");

    await expect(changeTrial({
      trialId: "trial",
      actorId: "actor",
      action: "SET_GRACE",
      graceDays: 15,
    })).rejects.toThrow("INVALID_GRACE_PERIOD");
  });

  it("locks the legacy lifecycle vocabulary needed for immutable-package adoption", () => {
    const source = readFileSync("lib/trials.ts", "utf8");
    for (const invariant of [
      "TRIAL_ALREADY_USED_THIS_YEAR",
      "TRIAL_ISSUED",
      "TRIAL_REVOKED",
      "TRIAL_GRACE_CHANGED",
      "TRIAL_GRANTED_BY_ADMIN",
      "TRIAL_STARTED",
      "7-day trial",
      'status: "PAID"',
      "totalMinor: 0",
    ]) {
      expect(source).toContain(invariant);
    }
  });
});
