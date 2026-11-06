import { describe, expect, it } from "vitest";
import { parseEmailSender } from "@/platform/email/sender";

describe("server-owned business email sender", () => {
  it("accepts a single bare address or named address", () => {
    expect(parseEmailSender("billing@bke.example")).toEqual({ email: "billing@bke.example" });
    expect(parseEmailSender(" BKE Billing <billing@bke.example> ")).toEqual({
      email: "billing@bke.example", name: "BKE Billing",
    });
  });
  it.each([
    "BKE\r\nBcc: stolen@bke.example <billing@bke.example>",
    "one@bke.example, two@bke.example",
    "BKE <one@bke.example><two@bke.example>",
    "not-an-address", "", undefined,
  ])("rejects malformed or multi-sender input", value => {
    expect(parseEmailSender(value)).toBeUndefined();
  });
});
